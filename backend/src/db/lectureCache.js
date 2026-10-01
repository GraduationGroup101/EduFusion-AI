const { randomUUID } = require('node:crypto');
const { readQuery, transaction } = require('./index');
const { ownerKey } = require('../lib/owner');

const MAX_TRANSCRIPT_CHARS = 1024 * 1024;
const QUIZ_LIMIT_PER_JOB = 20;

// The library is an optimisation over the transcription service: until
// 006_lecture_tools.sql (the table) and 012_lecture_library.sql (language and
// format columns) are applied on a deployed database, transcription must keep
// working exactly as before, just without reuse.
const UNDEFINED_TABLE = '42P01';
const UNDEFINED_COLUMN = '42703';
const warned = new Set();
const optional = async (work, fallback) => {
  try { return await work(); }
  catch (error) {
    if (![UNDEFINED_TABLE, UNDEFINED_COLUMN].includes(error?.code)) throw error;
    if (!warned.has(error.code)) {
      warned.add(error.code);
      console.warn(`Lecture library ${error.code === UNDEFINED_TABLE ? 'cache' : 'metadata'} unavailable: run \`npm run migrate --prefix backend\` to apply 006_lecture_tools.sql and 012_lecture_library.sql`);
    }
    return typeof fallback === 'function' ? fallback(error) : fallback;
  }
};
const legacyColumns = (legacy) => (error) => (error.code === UNDEFINED_COLUMN ? optional(legacy, null) : null);

const getTranscript = (jobId, kind) => optional(async () => (await readQuery(
  'SELECT content FROM edufusion_lecture_transcripts WHERE job_id=$1 AND kind=$2', [jobId, kind]
)).rows[0]?.content ?? null, null);

// The stored copy with the metadata describing which request produced it.
const getStoredTranscript = (jobId, kind) => optional(async () => (await readQuery(
  `SELECT content, title, video_id, youtube_url, language, mode, detected_language, format_version
   FROM edufusion_lecture_transcripts WHERE job_id=$1 AND kind=$2`, [jobId, kind]
)).rows[0] || null, legacyColumns(async () => (await readQuery(
  'SELECT content, title, video_id FROM edufusion_lecture_transcripts WHERE job_id=$1 AND kind=$2', [jobId, kind]
)).rows[0] || null));

// Map of job ID to the transcript kinds stored for it (one query for a whole list).
const availableKinds = (jobIds) => {
  const ids = [...new Set(jobIds)].filter((id) => typeof id === 'string' && id);
  const kinds = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return Promise.resolve(kinds);
  return optional(async () => {
    const result = await readQuery('SELECT job_id, kind FROM edufusion_lecture_transcripts WHERE job_id = ANY($1::text[])', [ids]);
    for (const row of result.rows) kinds.get(row.job_id)?.push(row.kind);
    return kinds;
  }, kinds);
};

// Metadata is only ever added, never cleared, by a later save of the same job.
const saveTranscript = (jobId, kind, content, { videoId = null, title = null, language = null, mode = null,
  detectedLanguage = null, formatVersion = null, youtubeUrl = null } = {}) => {
  const text = String(content).slice(0, MAX_TRANSCRIPT_CHARS);
  return optional(() => transaction((client) => client.query(
    `INSERT INTO edufusion_lecture_transcripts AS t(job_id,kind,video_id,title,content,language,mode,detected_language,format_version,youtube_url)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (job_id,kind) DO UPDATE SET content=EXCLUDED.content, video_id=COALESCE(EXCLUDED.video_id,t.video_id),
       title=COALESCE(EXCLUDED.title,t.title), language=COALESCE(EXCLUDED.language,t.language), mode=COALESCE(EXCLUDED.mode,t.mode),
       detected_language=COALESCE(EXCLUDED.detected_language,t.detected_language),
       format_version=COALESCE(EXCLUDED.format_version,t.format_version), youtube_url=COALESCE(EXCLUDED.youtube_url,t.youtube_url), updated_at=NOW()`,
    [jobId, kind, videoId, title, text, language, mode, detectedLanguage, formatVersion, youtubeUrl]
  )), legacyColumns(() => transaction((client) => client.query(
    `INSERT INTO edufusion_lecture_transcripts(job_id,kind,video_id,title,content) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (job_id,kind) DO UPDATE SET content=EXCLUDED.content, video_id=COALESCE(EXCLUDED.video_id,edufusion_lecture_transcripts.video_id),
       title=COALESCE(EXCLUDED.title,edufusion_lecture_transcripts.title), updated_at=NOW()`,
    [jobId, kind, videoId, title, text]
  ))));
};

// Newest stored lecture usable for a new request. Legacy rows (no format version)
// may be English translations and are never reused. A formatted request needs an
// AI-formatted copy; a fast request accepts any copy. An explicit language needs
// text detected in that language. 'auto' accepts only auto-detected copies: a copy
// made with a forced language is detected as that language even when the lecture
// was spoken in another one (forced Whisper translates), so it proves nothing.
const findReusable = ({ videoId, language, mode }) => optional(async () => {
  if (!videoId || !language || !mode) return null;
  const result = await readQuery(
    `SELECT job_id, kind, title, youtube_url, language, mode, detected_language, format_version
     FROM edufusion_lecture_transcripts
     WHERE video_id=$1 AND format_version IS NOT NULL
       AND ($3::text='fast' OR (mode='formatted' AND kind='cleaned'))
       AND CASE WHEN $2::text='auto' THEN language='auto'
                ELSE detected_language=$2::text AND language IN ($2::text,'auto') END
     ORDER BY (mode=$3::text) DESC, updated_at DESC LIMIT 1`, [videoId, language, mode]
  );
  return result.rows[0] || null;
}, null);

const listQuizzes = (user, jobId) => optional(async () => (await readQuery(
  'SELECT id, language, questions, created_at FROM edufusion_lecture_quizzes WHERE owner_key=$1 AND job_id=$2 ORDER BY created_at DESC LIMIT $3',
  [ownerKey(user), jobId, QUIZ_LIMIT_PER_JOB]
)).rows, []);

const saveQuiz = (user, jobId, language, questions) => transaction(async (client) => {
  const owner = ownerKey(user);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [owner]);
  await client.query(
    `DELETE FROM edufusion_lecture_quizzes WHERE owner_key=$1 AND job_id=$2 AND id IN (
       SELECT id FROM edufusion_lecture_quizzes WHERE owner_key=$1 AND job_id=$2 ORDER BY created_at DESC OFFSET $3)`,
    [owner, jobId, QUIZ_LIMIT_PER_JOB - 1]
  );
  const id = randomUUID();
  const created = await client.query(
    'INSERT INTO edufusion_lecture_quizzes(id,owner_key,job_id,language,questions) VALUES($1,$2,$3,$4,$5) RETURNING id, language, questions, created_at',
    [id, owner, jobId, language, JSON.stringify(questions)]
  );
  return created.rows[0];
});

module.exports = { getTranscript, getStoredTranscript, availableKinds, saveTranscript, findReusable, listQuizzes, saveQuiz, MAX_TRANSCRIPT_CHARS };
