const assert = require('node:assert/strict');
const { before, after, beforeEach, test } = require('node:test');
const { createHmac } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'lecture-library-isolated-test-secret-at-least-32';
process.env.LECTURESCRIBE_API_URL = 'https://provider.test';
process.env.LECTURESCRIBE_GATEWAY_KEY = 'gateway-secret';
process.env.ORAL_EXAM_ENABLED = 'true';
for (const key of ['GROQ_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_EN_VOICE_ID', 'ELEVENLABS_AR_VOICE_ID']) process.env[key] = 'test-only';
const db = require('../src/db');
const { migrate } = require('../scripts/migrate');
const library = require('../src/lectureLibrary');
const store = require('../src/db/appStore');
const cache = require('../src/db/lectureCache');
const { resolveMaterial } = require('../src/oralExam/material');
const { sync } = require('../scripts/syncLectureJobs');
const app = require('../src/app');

const ARABIC_RAW = 'الشبكات تنقل الحزم عبر الموجهات بين الأجهزة المختلفة. '.repeat(8);
const ARABIC_CLEANED = '## الشبكات\n\nالموجه يختار أفضل مسار بين الشبكات المختلفة، ويستخدم جدول التوجيه. '.repeat(6);
const ENGLISH = 'Routers forward packets between networks using routing tables. '.repeat(6);
const original = { query: db.pool.query, connect: db.pool.connect, fetch: global.fetch };
let database, server, calls = [];
// `failures` maps '<job>:<kind>' to how many transcript downloads of that kind fail next.
const provider = { jobs: new Map(), posts: [], next: 1, down: false, hang: false, failures: new Map() };
const auth = (id) => `Bearer ${jwt.sign({ id_student: id }, process.env.JWT_SECRET)}`;
const admin = () => `Bearer ${jwt.sign({ id: 1 }, process.env.JWT_SECRET)}`;
const api = (method, path, id) => request(server)[method](`/api/lecture-scribe${path}`).set('Authorization', id === 'admin' ? admin() : auth(id));
const submit = (id, video, body = {}) => api('post', '/jobs', id).send({ youtube_url: `https://youtu.be/${video}`, ...body });
const stored = async (jobId) => (await database.query(
  'SELECT kind, language, mode, detected_language, format_version, title, youtube_url, video_id FROM edufusion_lecture_transcripts WHERE job_id=$1 ORDER BY kind', [jobId])).rows;
const complete = (id, { cleaned = ARABIC_CLEANED, raw = ARABIC_RAW, detected = 'ar', format = 'source-language-v2', title = 'محاضرة الشبكات' } = {}) =>
  Object.assign(provider.jobs.get(id), { status: 'completed', detected_language: detected, format_version: format, title, transcripts: { cleaned, raw },
    result: { cleaned_transcript_path: cleaned ? '/srv/out/c.txt' : null, raw_transcript_path: '/srv/out/r.txt', audio_path: '/srv/a.mp3', cleaner_error: null } });
const sign = (jobId, status, timestamp = String(Math.floor(Date.now() / 1000)), key = 'gateway-secret') =>
  ({ timestamp, signature: `sha256=${createHmac('sha256', key).update(`${timestamp}.${jobId}.${status}`).digest('hex')}` });
const callback = (jobId, status, { timestamp, signature } = sign(jobId, status)) => request(server).post('/api/lecture-scribe/callback')
  .set('X-LectureScribe-Timestamp', timestamp).set('X-LectureScribe-Signature', signature).send({ event: 'job.finished', job_id: jobId, status });

before(async () => {
  database = await PGlite.create();
  db.pool.query = async (sql, params = []) => {
    const result = !params.length && sql.split(';').length > 2 ? (await database.exec(sql)).at(-1) : await database.query(sql, params);
    return { rows: result.rows || [], rowCount: result.affectedRows || result.rows?.length || 0 };
  };
  let tail = Promise.resolve();
  db.pool.connect = async () => { const previous = tail; let release; tail = new Promise((r) => { release = r; }); await previous; return { query: db.pool.query, release }; };
  await migrate();
  await database.query(`INSERT INTO students(id_student,student_name,email,pin_hash) VALUES
    (800,'Amal Haddad','amal@example.test','h'),(801,'Badr','badr@example.test','h'),(802,'Carim',NULL,'h'),(803,'Dina',NULL,'h'),
    (804,'Ehab',NULL,'h'),(805,'Fadi',NULL,'h'),(806,'Ghada',NULL,'h'),(807,'Hala',NULL,'h'),(808,'Iyad',NULL,'h'),(809,'Jana',NULL,'h')`);
  await database.query("INSERT INTO app_users(id,username,password_hash,role) VALUES(1,'root-admin','h','admin')");
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const address = new URL(String(url));
    if (address.hostname === 'www.youtube.com') return Response.json({ title: 'Routing basics' });
    if (provider.hang) return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    if (provider.down) return Response.json({ detail: 'down' }, { status: 503 });
    if (address.pathname === '/jobs' && options.method === 'POST') {
      const body = JSON.parse(options.body), id = `job-${provider.next++}`;
      provider.posts.push({ body, headers: options.headers });
      // The provider echoes its own request copy (with a different language) to prove EduFusion keeps the student's.
      provider.jobs.set(id, { job_id: id, status: 'queued', submitted_at: 100, language: body.language, request: { ...body, language: 'ar' }, result: null });
      return Response.json({ job_id: id, status: 'queued', status_url: `/jobs/${id}`, transcript_url: `/jobs/${id}/transcript` }, { status: 202 });
    }
    const match = /^\/jobs\/([^/]+)(\/transcript)?$/.exec(address.pathname);
    const job = match && provider.jobs.get(match[1]);
    if (!job) return Response.json({ detail: 'Job not found.' }, { status: 404 });
    if (!match[2]) return Response.json({ ...job, transcripts: undefined });
    if (job.status !== 'completed') return Response.json({ detail: `Job is ${job.status}.` }, { status: 409 });
    const failing = `${match[1]}:${address.searchParams.get('kind')}`;
    if (provider.failures.get(failing) > 0) {
      provider.failures.set(failing, provider.failures.get(failing) - 1);
      return Response.json({ detail: 'Bad gateway' }, { status: 502 });
    }
    const text = job.transcripts?.[address.searchParams.get('kind')];
    return text ? new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Language': job.detected_language } })
      : Response.json({ detail: 'No transcript.' }, { status: 404 });
  };
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
});
after(async () => {
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  db.pool.query = original.query; db.pool.connect = original.connect; global.fetch = original.fetch;
  await database.close(); await db.pool.end();
});
beforeEach(() => { calls = []; provider.down = false; provider.hang = false; provider.failures.clear(); });

test('submissions send the language explicitly with gateway headers and a callback, and keep the student request', async () => {
  assert.equal((await submit(800, 'x', { youtube_url: 'https://www.youtube.com/playlist?list=PL1' })).status, 400);
  assert.equal((await submit(800, 'AAAAAAAAAAA', { language: 'fr' })).status, 400);
  process.env.LECTURESCRIBE_CALLBACK_URL = 'https://api.example.test/api/lecture-scribe/callback';
  let response;
  try { response = await submit(800, 'AAAAAAAAAAA?list=PL9&t=30'); }
  finally { delete process.env.LECTURESCRIBE_CALLBACK_URL; }
  assert.equal(response.status, 202);
  const sent = provider.posts.at(-1);
  assert.deepEqual(sent.body, { youtube_url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', clean: true, language: 'auto', skip_audio_cache: false,
    use_cached_outputs: true, callback_url: 'https://api.example.test/api/lecture-scribe/callback' });
  assert.equal(sent.headers['X-Gateway-Key'], 'gateway-secret'); assert.match(sent.headers['X-Gateway-User'], /^[0-9a-f]{40}$/);
  assert.equal(response.body.title, 'Routing basics'); assert.equal(response.body.language, 'auto'); assert.equal(response.body.mode, 'formatted');
  assert.equal(typeof response.body.submitted_at, 'number'); assert.equal(response.body.status_url, undefined);
  const id = response.body.job_id;
  response = await api('get', `/jobs/${id}`, 800);
  assert.equal(response.status, 200); assert.equal(response.body.status, 'queued');
  assert.equal(response.body.request.language, 'auto'); assert.equal(response.body.language, 'auto');
  // Reads carry the gateway key too.
  assert.equal(calls.find((c) => c.url === `https://provider.test/jobs/${id}`).options.headers['X-Gateway-Key'], 'gateway-secret');
});

test('a lecture finishing while nobody watches is stored by the list sync and survives the provider forgetting it', async () => {
  const id = (await submit(801, 'BBBBBBBBBBB', { language: 'ar' })).body.job_id;
  complete(id);
  const list = await api('get', '/jobs', 801);
  assert.equal(list.body.jobs[0].job_id, id); assert.equal(list.body.jobs[0].status, 'completed');
  assert.deepEqual(list.body.jobs[0].result, { has_cleaned: true, has_raw: true, cleaned_transcript_path: 'stored', detected_language: 'ar', format_version: 'source-language-v2',
    produced_mode: null });
  const rows = await stored(id);
  assert.deepEqual(rows.map((row) => row.kind), ['cleaned', 'raw']);
  for (const row of rows) assert.deepEqual({ ...row, kind: undefined }, { kind: undefined, language: 'ar', mode: 'formatted', detected_language: 'ar',
    format_version: 'source-language-v2', title: 'Routing basics', youtube_url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB', video_id: 'BBBBBBBBBBB' });
  provider.jobs.delete(id);
  const job = await api('get', `/jobs/${id}`, 801);
  assert.equal(job.status, 200); assert.equal(job.body.status, 'completed');
  const transcript = await api('get', `/jobs/${id}/transcript?kind=cleaned`, 801);
  assert.equal(transcript.status, 200); assert.equal(transcript.headers['content-language'], 'ar'); assert.equal(transcript.text, ARABIC_CLEANED);
  assert.equal((await api('get', `/jobs/${id}/transcript?kind=raw`, 801)).text, ARABIC_RAW);
  const material = await resolveMaterial({ id_student: 801 }, { kind: 'transcript', id });
  assert.equal(material.title, 'Routing basics'); assert.match(material.context.chunks[0].text, /الشبكات/);
});

test('identical in-flight requests share one provider job; a forgotten job is marked lost for every owner', async () => {
  const first = await submit(802, 'CCCCCCCCCCC', { language: 'ar', clean: false });
  const posts = provider.posts.length;
  const second = await api('post', '/jobs', 803).send({ youtube_url: 'https://www.youtube.com/watch?v=CCCCCCCCCCC', language: 'ar', clean: false });
  assert.equal(second.status, 202); assert.equal(second.body.job_id, first.body.job_id); assert.equal(second.body.shared, true);
  assert.equal(provider.posts.length, posts);
  // The original student re-submitting gets their own save back, not a shared copy.
  const resubmitted = await submit(802, 'CCCCCCCCCCC', { language: 'ar', clean: false });
  assert.equal(resubmitted.status, 202); assert.equal(resubmitted.body.job_id, first.body.job_id); assert.equal(resubmitted.body.shared, false);
  assert.equal(provider.posts.length, posts);
  // Another language or mode is a different lecture request.
  assert.notEqual((await submit(803, 'CCCCCCCCCCC', { language: 'en', clean: false })).body.job_id, first.body.job_id);
  provider.jobs.delete(first.body.job_id);
  const lost = await api('get', `/jobs/${first.body.job_id}`, 802);
  assert.equal(lost.status, 200); assert.equal(lost.body.status, 'failed'); assert.equal(lost.body.lost, true); assert.equal(lost.body.error, library.LOST_ERROR);
  const other = (await api('get', '/jobs', 803)).body.jobs.find((job) => job.job_id === first.body.job_id);
  assert.equal(other.status, 'failed'); assert.equal(other.lost, true);
  // Submitting again starts a fresh transcription.
  const again = await submit(803, 'CCCCCCCCCCC', { language: 'ar', clean: false });
  assert.equal(again.status, 202); assert.notEqual(again.body.job_id, first.body.job_id); assert.equal(provider.posts.length, posts + 2);
});

test('a job the provider forgot is completed from a stored copy, and an unreachable provider keeps the job visible', async () => {
  await store.saveJob({ id_student: 804 }, { job_id: 'job-stored', status: 'running', request: { youtube_url: 'https://www.youtube.com/watch?v=JJJJJJJJJJJ', clean: true, language: 'auto' } });
  await cache.saveTranscript('job-stored', 'raw', ENGLISH, { videoId: 'JJJJJJJJJJJ' });
  const settled = await api('get', '/jobs/job-stored', 804);
  assert.equal(settled.body.status, 'completed'); assert.equal(settled.body.result.has_raw, true); assert.equal(settled.body.result.has_cleaned, false);
  const running = (await submit(804, 'KKKKKKKKKKK')).body.job_id;
  provider.down = true;
  const offline = await api('get', `/jobs/${running}`, 804);
  assert.equal(offline.status, 200); assert.equal(offline.body.provider_unavailable, true); assert.equal(offline.body.status, 'queued');
  assert.equal((await api('get', '/jobs', 804)).body.jobs.length, 2);
  assert.equal((await api('get', '/jobs/..%2F', 804)).status, 400);
});

test('signed callbacks store a finished lecture; bad or stale signatures are rejected', async () => {
  const id = (await submit(800, 'DDDDDDDDDDD', { language: 'ar' })).body.job_id;
  complete(id);
  assert.equal((await callback(id, 'completed', sign(id, 'completed', undefined, 'wrong-key'))).status, 401);
  assert.equal((await callback(id, 'completed', sign(id, 'failed'))).status, 401);
  assert.equal((await callback(id, 'completed', sign(id, 'completed', String(Math.floor(Date.now() / 1000) - 1000)))).status, 401);
  assert.equal((await stored(id)).length, 0);
  const accepted = await callback(id, 'completed');
  assert.equal(accepted.status, 200); assert.deepEqual(accepted.body, { ok: true });
  assert.equal((await stored(id)).length, 2);
  assert.equal((await store.getJob({ id_student: 800 }, id)).status, 'completed');
  assert.deepEqual((await callback('job-unknown', 'completed')).body, { ok: true, known: false });
});

test('reuse follows the language and mode rules and never serves legacy or mismatched copies', async () => {
  const save = (job, kind, meta, content = ENGLISH) => cache.saveTranscript(job, kind, content, { formatVersion: 'source-language-v2', mode: 'formatted', ...meta });
  await cache.saveTranscript('legacy-en', 'cleaned', ENGLISH, { videoId: 'EEEEEEEEEEE' });
  // Produced through the old pipeline (no format version) although its metadata matches.
  await cache.saveTranscript('old-pipeline-ar', 'raw', ARABIC_RAW, { videoId: 'EEEEEEEEEEE', language: 'ar', detectedLanguage: 'ar', mode: 'fast' });
  await save('auto-en', 'cleaned', { videoId: 'EEEEEEEEEEE', language: 'auto', detectedLanguage: 'en' });
  await save('ar-forced-en', 'cleaned', { videoId: 'EEEEEEEEEEE', language: 'ar', detectedLanguage: 'en' });
  await save('fast-ar', 'raw', { videoId: 'FFFFFFFFFFF', language: 'ar', detectedLanguage: 'ar', mode: 'fast' }, ARABIC_RAW);
  await save('formatted-ar', 'cleaned', { videoId: 'GGGGGGGGGGG', language: 'auto', detectedLanguage: 'ar', title: 'الشبكات' }, ARABIC_CLEANED);
  const find = async (videoId, language, mode) => (await library.findReusable({ videoId, language, mode }))?.job_id ?? null;
  assert.equal(await find('EEEEEEEEEEE', 'ar', 'formatted'), null);
  assert.equal(await find('EEEEEEEEEEE', 'ar', 'fast'), null);
  assert.equal(await find('EEEEEEEEEEE', 'en', 'formatted'), 'auto-en');
  assert.equal(await find('EEEEEEEEEEE', 'auto', 'formatted'), 'auto-en');
  assert.equal(await find('FFFFFFFFFFF', 'ar', 'formatted'), null);
  assert.equal(await find('FFFFFFFFFFF', 'ar', 'fast'), 'fast-ar');
  // A copy made with a forced language is detected as that language whatever was spoken: never offered to 'auto'.
  assert.equal(await find('FFFFFFFFFFF', 'auto', 'fast'), null);
  assert.equal(await find('FFFFFFFFFFF', 'en', 'fast'), null);
  assert.equal(await find('GGGGGGGGGGG', 'ar', 'fast'), 'formatted-ar');
  assert.equal(await find('GGGGGGGGGGG', 'en', 'formatted'), null);
  // An Arabic lecture someone forced to English (Whisper translated it) after an auto-detected copy existed.
  await save('auto-detected-ar', 'cleaned', { videoId: 'QQQQQQQQQQQ', language: 'auto', detectedLanguage: 'ar' }, ARABIC_CLEANED);
  await save('forced-en', 'cleaned', { videoId: 'QQQQQQQQQQQ', language: 'en', detectedLanguage: 'en' });
  await save('only-forced-en', 'cleaned', { videoId: 'RRRRRRRRRRR', language: 'en', detectedLanguage: 'en' });
  assert.equal(await find('QQQQQQQQQQQ', 'auto', 'formatted'), 'auto-detected-ar');
  assert.equal(await find('QQQQQQQQQQQ', 'en', 'formatted'), 'forced-en');
  assert.equal(await find('RRRRRRRRRRR', 'auto', 'fast'), null);
  assert.equal(await find('RRRRRRRRRRR', 'en', 'fast'), 'only-forced-en');
  // An Arabic request for a video only stored in English (or as a legacy copy) is transcribed afresh.
  const posts = provider.posts.length;
  const arabic = await submit(805, 'EEEEEEEEEEE', { language: 'ar' });
  assert.equal(arabic.status, 202); assert.equal(arabic.body.cached, false); assert.equal(provider.posts.length, posts + 1);
  calls = [];
  const reused = await submit(805, 'GGGGGGGGGGG', { language: 'ar', clean: false });
  assert.equal(reused.status, 200); assert.equal(reused.body.cached, true); assert.equal(reused.body.job_id, 'formatted-ar');
  assert.equal(reused.body.detected_language, 'ar'); assert.equal(reused.body.request.language, 'ar'); assert.equal(reused.body.title, 'الشبكات');
  // A fast request served an AI-formatted copy says so.
  assert.equal(reused.body.mode, 'fast'); assert.equal(reused.body.produced_mode, 'formatted');
  const auto = await submit(805, 'QQQQQQQQQQQ');
  assert.equal(auto.status, 200); assert.equal(auto.body.job_id, 'auto-detected-ar'); assert.equal(auto.body.detected_language, 'ar');
  assert.equal(calls.length, 0);
});

test('a formatted request the provider could only lay out deterministically is stored as fast, never reused as AI formatting', async () => {
  const id = (await submit(800, 'PPPPPPPPPPP', { language: 'ar' })).body.job_id;
  complete(id);
  const job = provider.jobs.get(id);
  Object.assign(job, { mode: 'fast', result: { ...job.result, mode: 'fast', requested_mode: 'formatted' } });
  const done = await api('get', `/jobs/${id}`, 800);
  assert.equal(done.body.status, 'completed'); assert.equal(done.body.mode, 'formatted'); assert.equal(done.body.produced_mode, 'fast');
  assert.deepEqual((await stored(id)).map((row) => [row.kind, row.mode]), [['cleaned', 'fast'], ['raw', 'fast']]);
  assert.equal(await library.findReusable({ videoId: 'PPPPPPPPPPP', language: 'ar', mode: 'formatted' }), null);
  assert.equal((await library.findReusable({ videoId: 'PPPPPPPPPPP', language: 'ar', mode: 'fast' })).job_id, id);
});

test('a formatted request is not handed a shared job that finished without AI formatting', async () => {
  const first = (await submit(800, 'SSSSSSSSSSS', { language: 'ar' })).body.job_id;
  complete(first);
  const job = provider.jobs.get(first);
  Object.assign(job, { mode: 'fast', result: { ...job.result, mode: 'fast', requested_mode: 'formatted' } });
  const posts = provider.posts.length;
  const formatted = await submit(801, 'SSSSSSSSSSS', { language: 'ar' });
  assert.equal(formatted.status, 202); assert.notEqual(formatted.body.job_id, first); assert.equal(provider.posts.length, posts + 1);
  // The plain layout it stored still serves a fast request instantly.
  const fast = await submit(805, 'SSSSSSSSSSS', { language: 'ar', clean: false });
  assert.equal(fast.status, 200); assert.equal(fast.body.job_id, first); assert.equal(fast.body.produced_mode, 'fast');
});

test('a queued job reports how many lectures are ahead of it until it starts', async () => {
  const id = (await submit(803, 'UUUUUUUUUUU', { language: 'en' })).body.job_id;
  provider.jobs.get(id).jobs_ahead = 3;
  assert.equal((await api('get', `/jobs/${id}`, 803)).body.jobs_ahead, 3);
  assert.equal((await api('get', '/jobs', 803)).body.jobs.find((job) => job.job_id === id).jobs_ahead, 3);
  const shared = await submit(804, 'UUUUUUUUUUU', { language: 'en' });
  assert.equal(shared.body.shared, true); assert.equal(shared.body.jobs_ahead, 3);
  Object.assign(provider.jobs.get(id), { status: 'running', jobs_ahead: undefined });
  assert.equal((await api('get', `/jobs/${id}`, 803)).body.jobs_ahead, null);
  assert.equal((await api('get', '/jobs', 804)).body.jobs.find((job) => job.job_id === id).jobs_ahead, null);
  assert.equal((await store.getJob({ id_student: 803 }, id)).jobs_ahead, null);
});

test('a transcript kind whose download failed is fetched again on opening, by the list sync and by the reconciliation script', async () => {
  // One failed formatted download while the student watches: the original is stored, the formatted copy follows on reopening.
  const watched = (await submit(809, 'VVVVVVVVVVV', { language: 'ar' })).body.job_id;
  complete(watched);
  provider.failures.set(`${watched}:cleaned`, 1);
  let open = await api('get', `/jobs/${watched}`, 809);
  assert.equal(open.body.status, 'completed'); assert.equal(open.body.result.has_raw, true); assert.equal(open.body.result.has_cleaned, false);
  assert.deepEqual((await stored(watched)).map((row) => row.kind), ['raw']);
  open = await api('get', `/jobs/${watched}`, 809);
  assert.equal(open.body.result.has_cleaned, true); assert.equal(open.body.provider_unavailable, undefined);
  assert.deepEqual((await stored(watched)).map((row) => row.kind), ['cleaned', 'raw']);
  assert.equal((await library.findReusable({ videoId: 'VVVVVVVVVVV', language: 'ar', mode: 'formatted' })).job_id, watched);
  calls = [];
  assert.equal((await api('get', `/jobs/${watched}`, 809)).body.result.has_cleaned, true);
  assert.equal(calls.length, 0);
  // Both downloads fail when the list first sees the completion: the next list refresh stores them.
  const unwatched = (await submit(809, 'WWWWWWWWWWW', { language: 'ar' })).body.job_id;
  complete(unwatched);
  provider.failures.set(`${unwatched}:cleaned`, 1); provider.failures.set(`${unwatched}:raw`, 1);
  const first = (await api('get', '/jobs', 809)).body.jobs.find((job) => job.job_id === unwatched);
  assert.equal(first.status, 'completed'); assert.equal((await stored(unwatched)).length, 0);
  const second = (await api('get', '/jobs', 809)).body.jobs.find((job) => job.job_id === unwatched);
  assert.equal(second.result.has_cleaned, true); assert.equal(second.result.has_raw, true);
  assert.equal((await stored(unwatched)).length, 2);
  // Nobody opens it: the reconciliation script fetches the missing formatted copy.
  const swept = (await submit(807, 'XXXXXXXXXXX', { language: 'ar' })).body.job_id;
  complete(swept);
  provider.failures.set(`${swept}:cleaned`, 1);
  assert.equal((await callback(swept, 'completed')).status, 503);
  assert.deepEqual((await stored(swept)).map((row) => row.kind), ['raw']);
  await sync({ budgetMs: 5000 });
  assert.deepEqual((await stored(swept)).map((row) => row.kind), ['cleaned', 'raw']);
  // A provider that forgot the job settles it with the kinds that are stored.
  const partial = (await submit(807, 'YYYYYYYYYYY', { language: 'ar' })).body.job_id;
  complete(partial);
  provider.failures.set(`${partial}:cleaned`, 1);
  await api('get', `/jobs/${partial}`, 807);
  provider.jobs.delete(partial);
  const settled = await api('get', `/jobs/${partial}`, 807);
  assert.equal(settled.body.status, 'completed'); assert.equal(settled.body.result.has_cleaned, false); assert.equal(settled.body.result.has_raw, true);
  calls = [];
  await api('get', `/jobs/${partial}`, 807);
  assert.equal(calls.length, 0);
});

test('a callback whose transcripts cannot be stored asks LectureScribe to retry', async () => {
  const id = (await submit(808, 'ZZZZZZZZZZZ', { language: 'ar' })).body.job_id;
  complete(id);
  provider.failures.set(`${id}:cleaned`, 1); provider.failures.set(`${id}:raw`, 1);
  const refused = await callback(id, 'completed');
  assert.equal(refused.status, 503); assert.equal((await stored(id)).length, 0);
  const retried = await callback(id, 'completed');
  assert.equal(retried.status, 200); assert.equal((await stored(id)).length, 2);
  // A finished lecture the service forgot before anything was stored says what happened.
  const lostId = (await submit(808, 'ZZZZZZZZZZY', { language: 'ar' })).body.job_id;
  complete(lostId);
  provider.failures.set(`${lostId}:cleaned`, 1); provider.failures.set(`${lostId}:raw`, 1);
  assert.equal((await callback(lostId, 'completed')).status, 503);
  provider.jobs.delete(lostId);
  const lost = await api('get', `/jobs/${lostId}`, 808);
  assert.equal(lost.body.status, 'failed'); assert.equal(lost.body.lost, true); assert.equal(lost.body.error, library.UNSAVED_ERROR);
});

test('saved lectures are never evicted, and lecture chats outlive a day and the chatbot session cap', async () => {
  await database.query("INSERT INTO edufusion_lecture_jobs(owner_key,job_id,job,created_at) SELECT 'student:806','bulk-'||n,jsonb_build_object('job_id','bulk-'||n,'status','completed'),NOW()-make_interval(mins => n) FROM generate_series(1,100) n");
  await store.saveJob({ id_student: 806 }, { job_id: 'bulk-new', status: 'queued' });
  await store.saveJob({ id_student: 806 }, { job_id: 'bulk-100', status: 'completed', cached: true });
  assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM edufusion_lecture_jobs WHERE owner_key='student:806'")).rows[0].n, 101);
  assert.equal((await store.listJobs({ id_student: 806 })).length, 101);
  const user = { id_student: 806 };
  await store.appendExchange(user, 'lecture:bulk-1', 'What is routing?', { answer: 'Path selection.', covered: true }, { persistent: true });
  for (let i = 0; i < 21; i += 1) await store.appendExchange(user, `chat-${i}`, 'hi', { answer: 'hello' });
  const sessions = (await database.query("SELECT session_id, expires_at FROM edufusion_chat_history WHERE owner_key='student:806'")).rows;
  assert.equal(sessions.filter((row) => row.session_id.startsWith('chat-')).length, 20);
  assert.equal(sessions.some((row) => row.session_id === 'chat-0'), false);
  await database.query("UPDATE edufusion_chat_history SET updated_at=NOW()-INTERVAL '30 days' WHERE session_id='lecture:bulk-1'");
  const history = await store.getHistory(user, 'lecture:bulk-1');
  assert.equal(history.length, 2); assert.equal(history[1].covered, true);
});

test('administrators see every lecture with who saved it, and only administrators read the saves log', async () => {
  const lectures = (await api('get', '/jobs', 'admin')).body.jobs;
  const shared = lectures.find((job) => job.shared === false && job.saved_count === 2 && job.saved_by.some((owner) => owner.name === 'Carim'));
  assert.ok(shared, 'the in-flight lecture lists both students');
  assert.deepEqual(shared.saved_by.map((owner) => [owner.type, owner.id, owner.name]), [['student', 802, 'Carim'], ['student', 803, 'Dina']]);
  assert.ok(shared.saved_by.every((owner) => owner.saved_at));
  assert.equal((await api('get', '/admin/saves', 800)).status, 403);
  const all = await api('get', '/admin/saves?limit=5', 'admin');
  assert.equal(all.status, 200); assert.equal(all.body.saves.length, 5);
  assert.equal(all.body.total, Number((await database.query('SELECT COUNT(*)::int AS n FROM edufusion_lecture_jobs')).rows[0].n));
  const page = await api('get', '/admin/saves?limit=5&offset=5', 'admin');
  assert.equal(page.body.saves.some((save) => all.body.saves.some((first) => first.job_id === save.job_id && first.owner.owner_key === save.owner.owner_key)), false);
  const amal = await api('get', '/admin/saves?q=amal', 'admin');
  assert.ok(amal.body.total >= 2); assert.ok(amal.body.saves.every((save) => save.owner.name === 'Amal Haddad'));
  assert.deepEqual(Object.keys(amal.body.saves[0]).sort(), ['detected_language', 'has_transcript', 'job_id', 'language', 'lost', 'mode', 'owner', 'saved_at', 'status',
    'title', 'youtube_url']);
  assert.equal(amal.body.saves[0].owner.email, 'amal@example.test');
  assert.ok((await api('get', '/admin/saves?q=Carim', 'admin')).body.saves.some((save) => save.lost === true && save.status === 'failed'));
  assert.ok((await api('get', '/admin/saves?q=801', 'admin')).body.saves.every((save) => save.owner.id === 801));
  const titled = await api('get', `/admin/saves?q=${encodeURIComponent('الشبكات')}`, 'admin');
  assert.equal(titled.body.saves[0]?.job_id, 'formatted-ar'); assert.equal(titled.body.saves[0].has_transcript, true);
  assert.equal((await api('get', '/admin/saves?q=100%25', 'admin')).body.total, 0);
});

test('without migration 012 the library still transcribes and stores, but never reuses', async () => {
  await database.query('ALTER TABLE edufusion_lecture_transcripts RENAME COLUMN format_version TO hidden_format_version');
  try {
    const created = await submit(807, 'HHHHHHHHHHH', { language: 'ar' });
    assert.equal(created.status, 202);
    complete(created.body.job_id);
    assert.equal((await api('get', `/jobs/${created.body.job_id}`, 807)).body.status, 'completed');
    assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM edufusion_lecture_transcripts WHERE job_id=$1', [created.body.job_id])).rows[0].n, 2);
    provider.down = true;
    assert.equal((await api('get', `/jobs/${created.body.job_id}/transcript?kind=raw`, 807)).text, ARABIC_RAW);
    assert.equal((await submit(808, 'HHHHHHHHHHH', { language: 'ar' })).status, 503);
  } finally { await database.query('ALTER TABLE edufusion_lecture_transcripts RENAME COLUMN hidden_format_version TO format_version'); }
});

test('oral exam materials include lectures that finished unobserved and read a provider-only raw copy once', async () => {
  const id = (await submit(809, 'IIIIIIIIIII', { language: 'ar' })).body.job_id;
  complete(id);
  const materials = await request(server).get('/api/oral-exam/materials').set('Authorization', auth(809));
  assert.ok(materials.body.materials.some((material) => material.kind === 'transcript' && material.id === id && material.title === 'Routing basics'));
  // A completed job whose formatted copy failed: the raw copy is read once, stored, then served offline.
  provider.jobs.set('job-raw-only', { job_id: 'job-raw-only', status: 'queued' });
  complete('job-raw-only', { cleaned: null });
  await store.saveJob({ id_student: 809 }, { job_id: 'job-raw-only', status: 'completed', request: { youtube_url: 'https://www.youtube.com/watch?v=LLLLLLLLLLL', clean: true, language: 'ar' } });
  assert.match((await resolveMaterial({ id_student: 809 }, { kind: 'transcript', id: 'job-raw-only' })).context.chunks[0].text, /الشبكات/);
  provider.down = true;
  assert.match((await resolveMaterial({ id_student: 809 }, { kind: 'transcript', id: 'job-raw-only' })).context.chunks[0].text, /الشبكات/);
  assert.deepEqual((await stored('job-raw-only')).map((row) => [row.kind, row.language, row.detected_language]), [['raw', 'ar', 'ar']]);
});

test('the reconciliation script stores finished lectures and settles lost ones', async () => {
  const finished = (await submit(808, 'MMMMMMMMMMM')).body.job_id;
  const vanished = (await submit(808, 'NNNNNNNNNNN')).body.job_id;
  complete(finished, { cleaned: ENGLISH, raw: ENGLISH, detected: 'en' });
  provider.jobs.delete(vanished);
  const report = await sync({ budgetMs: 5000 });
  assert.ok(report.checked >= 2);
  assert.equal((await stored(finished)).length, 2);
  assert.equal((await store.getJob({ id_student: 808 }, finished)).status, 'completed');
  const lost = await store.getJob({ id_student: 808 }, vanished);
  assert.equal(lost.status, 'failed'); assert.equal(lost.lost, true);
});

test('syncing answers within its budget while the provider hangs', async () => {
  provider.hang = true;
  const started = Date.now();
  const jobs = await library.syncPending([{ job_id: 'job-hanging', status: 'running' }], { budgetMs: 150 });
  assert.ok(Date.now() - started < 900);
  assert.deepEqual(jobs, [{ job_id: 'job-hanging', status: 'running' }]);
});

test('client views, signatures, language detection and owners', async () => {
  const view = library.publicJob({ job_id: 'j1', status: 'completed', status_url: 'https://provider.test/jobs/j1', audio_path: '/srv/a.mp3',
    request: { youtube_url: 'https://www.youtube.com/watch?v=OOOOOOOOOOO', clean: true, language: 'ar', skip_audio_cache: false },
    result: { raw_transcript_path: '/srv/r.txt', cleaned_transcript_path: '/srv/c.txt', cleaner_error: 'Traceback', transcription_info: { detected_language: 'arabic' } } });
  assert.doesNotMatch(JSON.stringify(view), /\/srv\/|Traceback|status_url|skip_audio_cache/);
  assert.deepEqual(view.request, { youtube_url: 'https://www.youtube.com/watch?v=OOOOOOOOOOO', clean: true, language: 'ar' });
  assert.equal(view.result.cleaned_transcript_path, 'stored'); assert.equal(view.detected_language, 'ar'); assert.equal(view.video_id, 'OOOOOOOOOOO');
  assert.equal(library.publicJob(view, ['raw']).result.has_cleaned, false);
  const { timestamp, signature } = sign('j1', 'completed');
  assert.equal(library.verifyCallback({ timestamp, signature, jobId: 'j1', status: 'completed' }), true);
  assert.equal(library.verifyCallback({ timestamp, signature, jobId: 'j2', status: 'completed' }), false);
  assert.equal(library.verifyCallback({ timestamp, signature, jobId: 'j1', status: 'completed' }, ''), false);
  assert.equal(library.detectTextLanguage(ARABIC_RAW), 'ar');
  assert.equal(library.detectTextLanguage(ENGLISH), 'en');
  assert.equal(library.detectTextLanguage('في هذه المحاضرة نشرح TCP و UDP و routing protocols بالتفصيل'), 'ar');
  assert.equal(library.detectTextLanguage('ok 123'), null);
  assert.equal(library.modeOf({ clean: false }), 'fast'); assert.equal(library.modeOf({}), 'formatted');
  const req = (protocol, host) => ({ protocol, get: () => host });
  assert.equal(library.callbackUrl(req('https', 'api.example.test')), 'https://api.example.test/api/lecture-scribe/callback');
  assert.equal(library.callbackUrl(req('https', 'localhost:5000')), null);
  assert.equal(library.callbackUrl(req('http', 'api.example.test')), null);
  assert.equal(library.callbackUrl(req('https', 'api.example.test'), {}), null);
  const owners = await library.describeOwners(['student:800', 'user:1', 'student:999999', 'bogus']);
  assert.deepEqual(owners.get('student:800'), { owner_key: 'student:800', type: 'student', id: 800, name: 'Amal Haddad', email: 'amal@example.test', role: null });
  assert.deepEqual(owners.get('user:1'), { owner_key: 'user:1', type: 'user', id: 1, name: 'root-admin', email: null, role: 'admin' });
  assert.equal(owners.get('student:999999').name, null);
});
