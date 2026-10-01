const assert = require('node:assert/strict');
const { before, after, beforeEach, test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'lecture-tools-isolated-test-secret-at-least-32';
process.env.LECTURESCRIBE_API_URL = 'https://lecturescribe.app';
process.env.GROQ_API_KEY = 'test-only';
const db = require('../src/db');
const { migrate } = require('../scripts/migrate');
const { resolveLectureScribeBase, videoId, LECTURESCRIBE_BASE } = require('../src/lib/lectureScribe');
const tools = require('../src/lectureTools');
const services = require('../src/routes/services');
const app = require('../src/app');
const original = { query: db.pool.query, connect: db.pool.connect, fetch: global.fetch };
let database, server, calls = [], provider = 'ok', modelReply;
const auth = (id = 700) => `Bearer ${jwt.sign({ id_student: id }, process.env.JWT_SECRET)}`;
const admin = () => `Bearer ${jwt.sign({ id: 1 }, process.env.JWT_SECRET)}`;
const groq = (content) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
const transcriptText = 'Packets travel through routers. A router selects the best path across networks. '.repeat(6);
before(async () => {
  database = await PGlite.create();
  db.pool.query = async (sql, params = []) => {
    const result = !params.length && sql.split(';').length > 2 ? (await database.exec(sql)).at(-1) : await database.query(sql, params);
    return { rows: result.rows || [], rowCount: result.affectedRows || result.rows?.length || 0 };
  };
  let tail = Promise.resolve();
  db.pool.connect = async () => { const previous = tail; let release; tail = new Promise((r) => { release = r; }); await previous; return { query: db.pool.query, release }; };
  await migrate();
  await database.query("INSERT INTO students(id_student,student_name,pin_hash) VALUES(700,'First','hash'),(701,'Second','hash'),(702,'Third','hash')");
  await database.query("INSERT INTO app_users(username,password_hash,role) VALUES('admin','hash','admin')");
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const address = String(url);
    if (address.includes('api.groq.com')) return provider === 'model-down' ? new Response('{}', { status: 503 }) : groq(modelReply);
    if (provider === 'down') return new Response('{"error":"down"}', { status: 503 });
    if (address.endsWith('/jobs') && options.method === 'POST') return new Response(JSON.stringify({ job_id: 'job-fresh', status: 'queued' }), { status: 202 });
    if (address.includes('/transcript')) return new Response(address.includes('kind=cleaned') ? transcriptText : 'raw words');
    // The provider echoes its own copy of the request; EduFusion must keep the student's.
    if (address.includes('/jobs/')) return new Response(JSON.stringify({ job_id: 'job-fresh', status: 'completed', submitted_at: 5, language: 'auto', detected_language: 'en',
      format_version: 'source-language-v2', request: { language: 'ar', clean: true }, result: { cleaned_transcript_path: '/srv/x.txt', raw_transcript_path: '/srv/r.txt', audio_path: '/srv/a.mp3' } }));
    return new Response('{"status":"ok"}');
  };
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
});
after(async () => {
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  db.pool.query = original.query; db.pool.connect = original.connect; global.fetch = original.fetch;
  await database.close(); await db.pool.end();
});
beforeEach(() => { calls = []; provider = 'ok'; });

test('the retired LectureScribe domain is replaced by the Render service and video IDs are canonical', () => {
  assert.equal(LECTURESCRIBE_BASE, 'https://lecturescribe-ai.onrender.com');
  assert.equal(resolveLectureScribeBase('https://lecturescribe.app/'), 'https://lecturescribe-ai.onrender.com');
  assert.equal(resolveLectureScribeBase('https://custom.example/'), 'https://custom.example');
  for (const url of ['https://youtu.be/abcdefghijk?t=4', 'https://www.youtube.com/watch?v=abcdefghijk&list=PL1', 'https://m.youtube.com/shorts/abcdefghijk', 'https://www.youtube.com/live/abcdefghijk'])
    assert.equal(videoId(url), 'abcdefghijk', url);
  assert.equal(videoId('https://www.youtube.com/playlist?list=PL1'), null);
});

test('a completed transcript is stored when first observed, served without the provider, and reused for another account', async () => {
  let response = await request(server).post('/api/lecture-scribe/jobs').set('Authorization', auth()).send({ youtube_url: 'https://youtu.be/abcdefghijk', clean: true });
  assert.equal(response.status, 202); assert.equal(response.body.job_id, 'job-fresh');
  assert.equal(JSON.parse(calls.find((c) => c.options.method === 'POST').options.body).language, 'auto');
  response = await request(server).get('/api/lecture-scribe/jobs/job-fresh').set('Authorization', auth());
  assert.equal(response.body.status, 'completed'); assert.equal(response.body.request.language, 'auto'); assert.equal(response.body.detected_language, 'en');
  assert.doesNotMatch(JSON.stringify(response.body), /\/srv\//);
  // Both kinds are stored on completion, before any transcript is read.
  assert.deepEqual((await database.query("SELECT kind, language, mode, detected_language, format_version FROM edufusion_lecture_transcripts WHERE job_id='job-fresh' ORDER BY kind")).rows,
    [{ kind: 'cleaned', language: 'auto', mode: 'formatted', detected_language: 'en', format_version: 'source-language-v2' },
      { kind: 'raw', language: 'auto', mode: 'formatted', detected_language: 'en', format_version: 'source-language-v2' }]);
  response = await request(server).get('/api/lecture-scribe/jobs/job-fresh/transcript?kind=cleaned').set('Authorization', auth());
  assert.equal(response.status, 200); assert.equal(response.text, transcriptText);
  provider = 'down'; calls = [];
  response = await request(server).get('/api/lecture-scribe/jobs/job-fresh/transcript?kind=cleaned').set('Authorization', auth());
  assert.equal(response.status, 200); assert.equal(response.text, transcriptText);
  assert.equal((await request(server).get('/api/lecture-scribe/jobs/job-fresh').set('Authorization', auth())).body.status, 'completed');
  assert.equal(calls.length, 0);
  // Another student submits the same video through a different URL form; a fast
  // request is satisfied by the stored formatted lecture.
  response = await request(server).post('/api/lecture-scribe/jobs').set('Authorization', auth(701)).send({ youtube_url: 'https://www.youtube.com/watch?v=abcdefghijk', clean: false });
  assert.equal(response.status, 200); assert.equal(response.body.cached, true); assert.equal(response.body.job_id, 'job-fresh'); assert.equal(response.body.status, 'completed');
  assert.equal(response.body.request.clean, false); assert.equal(response.body.result.has_cleaned, true);
  assert.equal(calls.length, 0);
  assert.equal((await request(server).get('/api/lecture-scribe/jobs').set('Authorization', auth(701))).body.jobs[0].job_id, 'job-fresh');
  response = await request(server).get('/api/lecture-scribe/jobs/job-fresh/transcript?kind=cleaned').set('Authorization', auth(701));
  assert.equal(response.status, 200); assert.equal(response.text, transcriptText);
  const adminList = (await request(server).get('/api/lecture-scribe/jobs').set('Authorization', admin())).body.jobs;
  assert.equal(adminList.map((j) => j.job_id).join(), 'job-fresh');
  assert.deepEqual(adminList[0].saved_by.map((owner) => owner.name), ['First', 'Second']); assert.equal(adminList[0].saved_count, 2);
  assert.equal((await request(server).get('/api/lecture-scribe/jobs/job-fresh/transcript').set('Authorization', admin())).status, 200);
});

test('lecture chat is grounded in the cached transcript, persisted per account and isolated', async () => {
  assert.deepEqual((await request(server).get('/api/lecture-scribe/tools/status').set('Authorization', auth())).body, { enabled: true });
  modelReply = { answer: 'A router selects the best path.', quotes: ['A router selects the best path'], covered: true };
  provider = 'down';
  let response = await request(server).post('/api/lecture-scribe/jobs/job-fresh/chat').set('Authorization', auth()).send({ question: 'What does a router do?' });
  assert.equal(response.status, 200); assert.equal(response.body.answer, 'A router selects the best path.'); assert.deepEqual(response.body.sources, ['A router selects the best path']);
  const sent = JSON.parse(calls.find((c) => c.url.includes('groq')).options.body);
  assert.equal(sent.response_format.type, 'json_schema'); assert.match(sent.messages[1].content, /Packets travel through routers/);
  response = await request(server).get('/api/lecture-scribe/jobs/job-fresh/chat').set('Authorization', auth());
  assert.equal(response.body.messages.length, 2); assert.equal(response.body.messages[1].role, 'assistant');
  assert.equal((await request(server).get('/api/lecture-scribe/jobs/job-fresh/chat').set('Authorization', auth(701))).body.messages.length, 0);
  assert.equal((await request(server).post('/api/lecture-scribe/jobs/job-fresh/chat').set('Authorization', auth(702)).send({ question: 'hi' })).status, 404);
  assert.equal((await request(server).post('/api/lecture-scribe/jobs/job-fresh/chat').set('Authorization', auth()).send({ question: '' })).status, 400);
  provider = 'model-down';
  response = await request(server).post('/api/lecture-scribe/jobs/job-fresh/chat').set('Authorization', auth()).send({ question: 'again?' });
  assert.equal(response.status, 503); assert.doesNotMatch(response.text, /groq/i);
  assert.equal((await request(server).delete('/api/lecture-scribe/jobs/job-fresh/chat').set('Authorization', auth())).status, 200);
  assert.equal((await request(server).get('/api/lecture-scribe/jobs/job-fresh/chat').set('Authorization', auth())).body.messages.length, 0);
});

test('practice questions validate counts, drop malformed items and are stored privately', async () => {
  for (const body of [{}, { num_mcq: 11 }, { num_mcq: '2x' }, { num_mcq: 1, language: 'fr' }])
    assert.equal((await request(server).post('/api/lecture-scribe/jobs/job-fresh/quizzes').set('Authorization', auth()).send(body)).status, 400);
  modelReply = { questions: [
    { type: 'mcq', prompt: 'What selects a path?', choices: ['Router', 'Cable', 'Screen', 'Mouse'], answer_index: 0, answer: '', explanation: 'Routers select paths.' },
    { type: 'mcq', prompt: 'Broken choices', choices: ['Only one'], answer_index: 0, answer: '', explanation: '' },
    { type: 'tf', prompt: 'Packets travel through routers.', choices: ['True', 'False'], answer_index: 0, answer: '', explanation: 'Stated in the lecture.' },
    { type: 'essay', prompt: 'Explain routing.', choices: [], answer_index: 2, answer: 'Routers choose paths across networks.', explanation: '' },
  ] };
  let response = await request(server).post('/api/lecture-scribe/jobs/job-fresh/quizzes').set('Authorization', auth()).send({ num_mcq: 1, num_tf: 1, num_essay: 1 });
  assert.equal(response.status, 201);
  const questions = response.body.quiz.questions;
  assert.deepEqual(questions.map((q) => q.type), ['mcq', 'tf', 'essay']);
  assert.equal(questions[2].answer_index, null); assert.equal(questions[0].id, 'q001');
  assert.equal((await request(server).get('/api/lecture-scribe/jobs/job-fresh/quizzes').set('Authorization', auth())).body.quizzes.length, 1);
  assert.equal((await request(server).get('/api/lecture-scribe/jobs/job-fresh/quizzes').set('Authorization', auth(701))).body.quizzes.length, 0);
  assert.throws(() => tools.validateQuiz({ questions: [{ type: 'mcq', prompt: 'x'.repeat(6), choices: [], answer_index: null, answer: '', explanation: '' }] }, { mcq: 1, tf: 0, essay: 0 }), { statusCode: 502 });
});

test('job creation identifies this gateway to the provider only when a key is configured', async () => {
  const { gatewayHeaders } = require('../src/lib/lectureScribe');
  assert.deepEqual(gatewayHeaders({ id_student: 5 }, {}), {});
  assert.deepEqual(gatewayHeaders(null, { LECTURESCRIBE_GATEWAY_KEY: 'shared' }), { 'X-Gateway-Key': 'shared' });
  const identified = gatewayHeaders({ id_student: 702 }, { LECTURESCRIBE_GATEWAY_KEY: 'shared' });
  assert.match(identified['X-Gateway-User'], /^[0-9a-f]{40}$/);
  assert.notEqual(identified['X-Gateway-User'], gatewayHeaders({ id_student: 703 }, { LECTURESCRIBE_GATEWAY_KEY: 'shared' })['X-Gateway-User']);
  assert.doesNotMatch(identified['X-Gateway-User'], /702/);
  process.env.LECTURESCRIBE_GATEWAY_KEY = 'shared';
  try {
    assert.equal((await request(server).post('/api/lecture-scribe/jobs').set('Authorization', auth(702)).send({ youtube_url: 'https://youtu.be/qqqqqqqqqqq' })).status, 202);
    assert.equal(calls.at(-1).options.headers['X-Gateway-Key'], 'shared');
    assert.equal(calls.at(-1).options.headers['X-Gateway-User'], gatewayHeaders({ id_student: 702 }, { LECTURESCRIBE_GATEWAY_KEY: 'shared' })['X-Gateway-User']);
  } finally { delete process.env.LECTURESCRIBE_GATEWAY_KEY; }
  assert.equal((await request(server).post('/api/lecture-scribe/jobs').set('Authorization', auth(702)).send({ youtube_url: 'https://youtu.be/rrrrrrrrrrr' })).status, 202);
  assert.equal(calls.at(-1).options.headers['X-Gateway-Key'], undefined);
});

test('transcription keeps working on a database that has not applied the cache migration yet', async () => {
  await database.query('ALTER TABLE edufusion_lecture_transcripts RENAME TO hidden_transcripts');
  try {
    const created = await request(server).post('/api/lecture-scribe/jobs').set('Authorization', auth(701)).send({ youtube_url: 'https://youtu.be/zyxwvutsrqp' });
    assert.equal(created.status, 202); assert.equal(created.body.cached, false);
    const transcript = await request(server).get('/api/lecture-scribe/jobs/job-fresh/transcript?kind=raw').set('Authorization', auth());
    assert.equal(transcript.status, 200); assert.equal(transcript.text, 'raw words');
  } finally { await database.query('ALTER TABLE hidden_transcripts RENAME TO edufusion_lecture_transcripts'); }
});

test('long transcripts are excerpted around the question within the model budget', () => {
  const long = 'filler sentence about nothing in particular. '.repeat(3000) + 'The quicksort pivot partitions the array. ' + 'more filler. '.repeat(2000);
  const context = tools.excerpt(long, 'How does the quicksort pivot work?');
  assert.ok(context.length <= 60000 + 200); assert.match(context, /quicksort pivot/);
  assert.equal(tools.excerpt('short'), 'short');
});

test('tools report unavailable without a model key and require a ready transcript', async () => {
  const key = process.env.GROQ_API_KEY; delete process.env.GROQ_API_KEY;
  try {
    assert.deepEqual((await request(server).get('/api/lecture-scribe/tools/status').set('Authorization', auth())).body, { enabled: false });
    assert.equal((await request(server).post('/api/lecture-scribe/jobs/job-fresh/chat').set('Authorization', auth()).send({ question: 'hi' })).status, 503);
  } finally { process.env.GROQ_API_KEY = key; }
  await database.query("INSERT INTO edufusion_lecture_jobs(owner_key,job_id,job) VALUES('student:700','job-empty','{\"job_id\":\"job-empty\",\"status\":\"running\"}')");
  provider = 'down';
  assert.equal((await request(server).post('/api/lecture-scribe/jobs/job-empty/chat').set('Authorization', auth()).send({ question: 'hi' })).status, 409);
});

test('sign-in warm-up pings sleeping services once a minute and returns browser targets', async () => {
  const response = await request(server).get('/api/services/warm-up').set('Authorization', auth());
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.targets.map((t) => t.name), ['lecturescribe', 'chatbot', 'question-generator', 'edupredict']);
  assert.equal(response.body.targets[0].url, 'https://lecturescribe-ai.onrender.com/health');
  assert.equal(response.body.targets[1].url, 'https://final-iug-chat-botv3.onrender.com/live');
  assert.equal(response.body.started.length, 4);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.filter((c) => c.url.endsWith('/health') || c.url.endsWith('/live')).length, 4);
  const again = await request(server).get('/api/services/warm-up').set('Authorization', auth(701));
  assert.deepEqual(again.body.started, []);
  assert.equal((await request(server).get('/api/services/warm-up')).status, 401);
  const pinged = []; services.warm([{ name: 'x', url: 'https://x.example/health' }], async (url) => { pinged.push(url); throw new Error('cold'); });
  assert.deepEqual(pinged, ['https://x.example/health']);
});
