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

const appendExchange = (user, sessionId, question, data) => transaction(async (client) => {
  const owner = ownerKey(user);
  // Serialize changes for this owner so concurrent requests cannot lose turns
  // or exceed the session cap. No automatic retry of these writes.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [owner]);
  await client.query('DELETE FROM edufusion_chat_history WHERE owner_key = $1 AND expires_at <= NOW()', [owner]);
  const current = await client.query('SELECT messages FROM edufusion_chat_history WHERE owner_key=$1 AND session_id=$2', [owner, sessionId]);
  if (!current.rowCount) {
    const count = await client.query('SELECT COUNT(*)::int AS count FROM edufusion_chat_history WHERE owner_key=$1', [owner]);
    if (count.rows[0].count >= SESSION_LIMIT) {
      await client.query('DELETE FROM edufusion_chat_history WHERE owner_key=$1 AND session_id=(SELECT session_id FROM edufusion_chat_history WHERE owner_key=$1 ORDER BY updated_at LIMIT 1)', [owner]);
    }
  }
  const created_at = new Date().toISOString();
  const messages = [...(current.rows[0]?.messages || []), { role: 'user', content: question, created_at },
    { role: 'assistant', content: String(data.answer || data.response || '').slice(0, 20000), sources: data.top_chunks || data.sources || [], created_at }].slice(-HISTORY_LIMIT);
  await client.query(
    `INSERT INTO edufusion_chat_history (owner_key,session_id,messages,expires_at) VALUES ($1,$2,$3,NOW()+INTERVAL '24 hours')
     ON CONFLICT (owner_key,session_id) DO UPDATE SET messages=EXCLUDED.messages, expires_at=EXCLUDED.expires_at, updated_at=NOW()`,
    [owner, sessionId, JSON.stringify(messages)]
  );
});

const deleteHistory = (user, sessionId) => transaction((client) => client.query(
  'DELETE FROM edufusion_chat_history WHERE owner_key=$1 AND session_id=$2', [ownerKey(user), sessionId]
));

// Store only a job produced by this authenticated create request. A cached
// upstream ID can have multiple legitimate creation entitlements; never expose
// the provider's global job list or allow an arbitrary ID to claim ownership.
const saveJob = (user, job) => transaction(async (client) => {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ownerKey(user)]);
  const count = await client.query('SELECT COUNT(*)::int AS count FROM edufusion_lecture_jobs WHERE owner_key=$1', [ownerKey(user)]);
  if (count.rows[0].count >= 100) await client.query('DELETE FROM edufusion_lecture_jobs WHERE owner_key=$1 AND job_id=(SELECT job_id FROM edufusion_lecture_jobs WHERE owner_key=$1 ORDER BY created_at LIMIT 1)', [ownerKey(user)]);
  await client.query('INSERT INTO edufusion_lecture_jobs(owner_key,job_id,job) VALUES($1,$2,$3) ON CONFLICT(owner_key,job_id) DO UPDATE SET job=EXCLUDED.job', [ownerKey(user), job.job_id, JSON.stringify(job)]);
});

const ownsJob = async (user, jobId) => (await readQuery('SELECT 1 FROM edufusion_lecture_jobs WHERE owner_key=$1 AND job_id=$2', [ownerKey(user), jobId])).rowCount > 0;
const listJobs = async (user) => (await readQuery('SELECT job FROM edufusion_lecture_jobs WHERE owner_key=$1 ORDER BY created_at DESC LIMIT 100', [ownerKey(user)])).rows.map((row) => row.job);
const refreshJob = (user, job) => transaction((client) => client.query('UPDATE edufusion_lecture_jobs SET job=$3 WHERE owner_key=$1 AND job_id=$2', [ownerKey(user), job.job_id, JSON.stringify(job)]));

module.exports = { getHistory, appendExchange, deleteHistory, saveJob, ownsJob, listJobs, refreshJob };
