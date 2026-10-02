const { readQuery, transaction } = require('./index');
const { ownerKey } = require('../lib/owner');

const HISTORY_LIMIT = 100;
const SESSION_LIMIT = 20;

const getHistory = async (user, sessionId) => {
  const result = await readQuery(
    'SELECT messages FROM edufusion_chat_history WHERE owner_key = $1 AND session_id = $2 AND expires_at > NOW()',
    [ownerKey(user), sessionId]
  );
  return result.rows[0]?.messages || [];
};

// A persistent conversation (a saved lecture's chat) never expires and is
// outside the chatbot's session cap, so it can neither evict nor be evicted by
// chatbot sessions; it is still trimmed to the newest HISTORY_LIMIT messages.
const appendExchange = (user, sessionId, question, data, { persistent = false } = {}) => transaction(async (client) => {
  const owner = ownerKey(user);
  // Serialize changes for this owner so concurrent requests cannot lose turns
  // or exceed the session cap. No automatic retry of these writes.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [owner]);
  await client.query('DELETE FROM edufusion_chat_history WHERE owner_key = $1 AND expires_at <= NOW()', [owner]);
  const current = await client.query('SELECT messages FROM edufusion_chat_history WHERE owner_key=$1 AND session_id=$2', [owner, sessionId]);
  if (!current.rowCount && !persistent) {
    const count = await client.query("SELECT COUNT(*)::int AS count FROM edufusion_chat_history WHERE owner_key=$1 AND expires_at<>'infinity'", [owner]);
    if (count.rows[0].count >= SESSION_LIMIT) {
      await client.query("DELETE FROM edufusion_chat_history WHERE owner_key=$1 AND session_id=(SELECT session_id FROM edufusion_chat_history WHERE owner_key=$1 AND expires_at<>'infinity' ORDER BY updated_at LIMIT 1)", [owner]);
    }
  }
  const created_at = new Date().toISOString();
  const messages = [...(current.rows[0]?.messages || []), { role: 'user', content: question, created_at },
    { role: 'assistant', content: String(data.answer || data.response || '').slice(0, 20000), sources: data.top_chunks || data.sources || [],
      ...(typeof data.covered === 'boolean' ? { covered: data.covered } : {}), ...(typeof data.source === 'string' ? { source: data.source.slice(0, 40) } : {}), created_at }].slice(-HISTORY_LIMIT);
  await client.query(
    `INSERT INTO edufusion_chat_history (owner_key,session_id,messages,expires_at)
     VALUES ($1,$2,$3,CASE WHEN $4::boolean THEN 'infinity'::timestamptz ELSE NOW()+INTERVAL '24 hours' END)
     ON CONFLICT (owner_key,session_id) DO UPDATE SET messages=EXCLUDED.messages, expires_at=EXCLUDED.expires_at, updated_at=NOW()`,
    [owner, sessionId, JSON.stringify(messages), persistent]
  );
});

const deleteHistory = (user, sessionId) => transaction((client) => client.query(
  'DELETE FROM edufusion_chat_history WHERE owner_key=$1 AND session_id=$2', [ownerKey(user), sessionId]
));

// Creation, reuse of a stored lecture and an explicit admin import grant an
// account access to a job. Saves are never deleted automatically: each row is a
// student's entitlement and the administrator's record of who saved the lecture.
// A re-save merges into the owner's row; student access must never be granted
// by merely supplying an arbitrary ID.
const saveJob = (user, job) => transaction((client) => client.query(
  `INSERT INTO edufusion_lecture_jobs(owner_key,job_id,job) VALUES($1,$2,$3)
   ON CONFLICT(owner_key,job_id) DO UPDATE SET job=edufusion_lecture_jobs.job||EXCLUDED.job`,
  [ownerKey(user), job.job_id, JSON.stringify(job)]
));

const withId = (row) => ({ ...row.job, job_id: row.job_id });
const ownsJob = async (user, jobId) => (await readQuery('SELECT 1 FROM edufusion_lecture_jobs WHERE owner_key=$1 AND job_id=$2', [ownerKey(user), jobId])).rowCount > 0;
const listJobs = async (user) => (await readQuery('SELECT job_id, job FROM edufusion_lecture_jobs WHERE owner_key=$1 ORDER BY created_at DESC LIMIT 500', [ownerKey(user)])).rows.map(withId);
const getJob = async (user, jobId) => {
  const row = (await readQuery('SELECT job_id, job FROM edufusion_lecture_jobs WHERE owner_key=$1 AND job_id=$2', [ownerKey(user), jobId])).rows[0];
  return row ? withId(row) : undefined;
};
const getAnyJob = async (id) => {
  const row = (await readQuery('SELECT job_id, job FROM edufusion_lecture_jobs WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1', [id])).rows[0];
  return row ? withId(row) : undefined;
};

// One entry per lecture, most recently saved first, with every owner and when they saved it.
// The first saver's row represents the lecture (it carries the original request).
const listLectures = async ({ limit = 500 } = {}) => (await readQuery(
  `SELECT job_id, (array_agg(job ORDER BY created_at))[1] AS job,
     json_agg(json_build_object('owner_key',owner_key,'saved_at',created_at) ORDER BY created_at) AS owners
   FROM edufusion_lecture_jobs GROUP BY job_id ORDER BY MAX(created_at) DESC LIMIT $1`, [limit]
)).rows.map((row) => ({ job_id: row.job_id, job: withId(row), owners: row.owners || [] }));

// Every individual save (owner + lecture), newest first, joined to the owner's account.
const escapeLike = (value) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
const listSaves = async ({ q = null, limit = 25, offset = 0 } = {}) => {
  const from = `FROM edufusion_lecture_jobs j
    LEFT JOIN students s ON j.owner_key = 'student:' || s.id_student::text
    LEFT JOIN app_users u ON j.owner_key = 'user:' || u.id::text
    WHERE $1::text IS NULL OR s.student_name ILIKE $1 OR s.id_student::text=$2 OR u.username ILIKE $1
      OR j.job->>'title' ILIKE $1 OR j.job->>'youtube_url' ILIKE $1 OR j.job->'request'->>'youtube_url' ILIKE $1 OR j.job->>'video_id'=$2`;
  const filters = [q ? escapeLike(q) : null, q];
  const page = (transcripts) => readQuery(
    `SELECT j.owner_key, j.job_id, j.job, j.created_at, s.student_name, s.email, u.username, u.role,
       ${transcripts ? 'EXISTS(SELECT 1 FROM edufusion_lecture_transcripts t WHERE t.job_id=j.job_id)' : 'false'} AS has_transcript
     ${from} ORDER BY j.created_at DESC, j.owner_key, j.job_id LIMIT $3 OFFSET $4`, [...filters, limit, offset]);
  const [rows, count] = await Promise.all([
    page(true).catch((error) => { if (error?.code === '42P01') return page(false); throw error; }),
    readQuery(`SELECT COUNT(*)::int AS total ${from}`, filters),
  ]);
  return { rows: rows.rows.map((row) => ({ ...row, job: withId(row) })), total: count.rows[0].total };
};

// Newest unfinished save of the same lecture request (any owner, recent only).
const findInflightJob = async ({ videoId, language, mode }) => {
  const row = (await readQuery(
    `SELECT job_id, job FROM edufusion_lecture_jobs
     WHERE job->>'video_id'=$1 AND job->>'language'=$2 AND job->>'mode'=$3 AND COALESCE(job->>'status','queued') IN ('queued','running')
       AND created_at > NOW()-INTERVAL '6 hours'
     ORDER BY created_at DESC LIMIT 1`, [videoId, language, mode]
  )).rows[0];
  return row ? withId(row) : null;
};

// Jobs needing reconciliation with the provider: unfinished ones, and recent
// completed ones whose transcript was never stored, or which lack a kind the
// provider reported (a download that failed once must not lose that kind).
const listUnsettledJobs = async ({ days = 30 } = {}) => {
  const missing = (kind) => `((job->'result'->>'has_${kind}')='true'
           AND NOT EXISTS (SELECT 1 FROM edufusion_lecture_transcripts t WHERE t.job_id=j.job_id AND t.kind='${kind}'))`;
  const select = (transcripts) => readQuery(
    `SELECT DISTINCT ON (job_id) job_id, job FROM edufusion_lecture_jobs j
     WHERE COALESCE(job->>'status','queued') NOT IN ('completed','failed')
       ${transcripts ? `OR (job->>'status'='completed' AND COALESCE(job->>'lost','false')<>'true'
         AND created_at > NOW()-make_interval(days => $1::int)
         AND (NOT EXISTS (SELECT 1 FROM edufusion_lecture_transcripts t WHERE t.job_id=j.job_id) OR ${missing('cleaned')} OR ${missing('raw')}))`
    : 'AND $1::int IS NOT NULL'}
     ORDER BY job_id, created_at`, [days]);
  const result = await select(true).catch((error) => { if (error?.code === '42P01') return select(false); throw error; });
  return result.rows.map(withId);
};

// Provider state is merged into EVERY owner's row of a job. The owner's own
// request is never replaced; `defaults` only fill fields a row does not have yet.
const patchJob = async (jobId, patch, defaults = {}) => (await transaction((client) => client.query(
  "UPDATE edufusion_lecture_jobs SET job=$3::jsonb||job||($2::jsonb-'request') WHERE job_id=$1",
  [jobId, JSON.stringify(patch), JSON.stringify(defaults)]
))).rowCount;

module.exports = { getHistory, appendExchange, deleteHistory, saveJob, ownsJob, listJobs, getJob, getAnyJob, listLectures, listSaves,
  findInflightJob, listUnsettledJobs, patchJob };
