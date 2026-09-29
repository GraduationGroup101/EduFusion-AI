const { randomUUID } = require('node:crypto');
const { readQuery, transaction } = require('./index');
const { ownerKey } = require('../lib/owner');

const MAX_TRANSCRIPT_CHARS = 1024 * 1024;
const QUIZ_LIMIT_PER_JOB = 20;

const getTranscript = async (jobId, kind) => (await readQuery(
  'SELECT content FROM edufusion_lecture_transcripts WHERE job_id=$1 AND kind=$2', [jobId, kind]
)).rows[0]?.content ?? null;

const saveTranscript = (jobId, kind, content, { videoId = null, title = null } = {}) => transaction((client) => client.query(
  `INSERT INTO edufusion_lecture_transcripts(job_id,kind,video_id,title,content) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT (job_id,kind) DO UPDATE SET content=EXCLUDED.content, video_id=COALESCE(EXCLUDED.video_id,edufusion_lecture_transcripts.video_id),
     title=COALESCE(EXCLUDED.title,edufusion_lecture_transcripts.title), updated_at=NOW()`,
  [jobId, kind, videoId, title, String(content).slice(0, MAX_TRANSCRIPT_CHARS)]
));

// Newest cached transcript for a video; a cleaned copy is preferred over raw output.
const findCachedByVideo = async (videoId) => {
  if (!videoId) return null;
  const result = await readQuery(
    `SELECT job_id, kind, title FROM edufusion_lecture_transcripts WHERE video_id=$1
     ORDER BY (kind='cleaned') DESC, updated_at DESC LIMIT 1`, [videoId]
  );
  return result.rows[0] || null;
};

const listQuizzes = async (user, jobId) => (await readQuery(
  'SELECT id, language, questions, created_at FROM edufusion_lecture_quizzes WHERE owner_key=$1 AND job_id=$2 ORDER BY created_at DESC LIMIT $3',
  [ownerKey(user), jobId, QUIZ_LIMIT_PER_JOB]
)).rows;

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

module.exports = { getTranscript, saveTranscript, findCachedByVideo, listQuizzes, saveQuiz, MAX_TRANSCRIPT_CHARS };
