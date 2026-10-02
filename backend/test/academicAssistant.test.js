const assert = require('node:assert/strict');
const { before, after, beforeEach, test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters';
process.env.DEMO_ADMIN_PASSWORD = 'test-admin-password';
process.env.CHATBOT_API_URL = 'https://final-iug-chat-botv3.onrender.com';
const { pool } = require('../src/db');
const { migrate } = require('../scripts/migrate');
const { seed } = require('../scripts/seed');
const { registerStudentWithEnrollment } = require('../src/db/queries');
const app = require('../src/app');

const originalQuery = pool.query, originalConnect = pool.connect, originalFetch = global.fetch;
let database, server, tail = Promise.resolve();
let calls = [], modelMode = 'ok', route = null;
const normalize = (result) => ({ rows: result.rows || [], rowCount: result.rows?.length || result.affectedRows || 0 });
const execute = async (sql, params) => (!params?.length && sql.split(';').length > 2 ? normalize((await database.exec(sql)).at(-1)) : normalize(await database.query(sql, params)));
const studentToken = (id) => jwt.sign({ id_student: id }, process.env.JWT_SECRET);
const adminToken = () => jwt.sign({ id: 1 }, process.env.JWT_SECRET);
const profile = (id, name) => ({ id_student: id, course_presentation_id: 1, pin: 'abcd1234', student_name: name, email: null, gender: 'F', disability: 'N',
  age_band: '0-35', highest_education: 'A Level or Equivalent', imd_band: '50-60%', region: 'Unknown', num_of_prev_attempts: 0, studied_credits: 60, date_registration: 0 });
const ask = (token, question) => request(server).post('/api/chatbot/chat').set('Authorization', `Bearer ${token}`).send({ question, session_id: 'academic-test' });
const modelCalls = () => calls.filter((c) => c.url.includes('api.groq.com')).map((c) => JSON.parse(c.options.body));

before(async () => {
  database = new PGlite();
  pool.query = execute;
  pool.connect = async () => { const previous = tail; let release; tail = new Promise((r) => { release = r; }); await previous; return { query: execute, release }; };
  await migrate(); await seed();
  await registerStudentWithEnrollment(profile(20240001, 'Sara Ahmad'));
  await registerStudentWithEnrollment(profile(20240002, 'Omar Khalil'));
  await registerStudentWithEnrollment(profile(20240003, 'Omar Haddad'));
  const day = (await database.query('SELECT current_day FROM academic_clocks LIMIT 1')).rows[0].current_day;
  const enrollment = async (id) => (await database.query('SELECT id FROM enrollments WHERE id_student=$1', [id])).rows[0].id;
  await database.query(`INSERT INTO predictions(enrollment_id,day_of_course,risk_probability,risk_level,at_risk,recommended_action,explanation)
    VALUES($1,$2,0.82,'HIGH',true,'Contact your tutor this week',$3),($4,$2,0.12,'LOW',false,null,$5)`,
  [await enrollment(20240002), day, JSON.stringify(['No assessment submitted yet', 'Very little platform activity']), await enrollment(20240001), JSON.stringify(['Regular study activity'])]);
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('api.groq.com')) {
      if (modelMode === 'down') return new Response('{}', { status: 503 });
      const body = JSON.parse(options.body);
      const content = body.response_format.json_schema.name === 'academic_route'
        ? route : { answer: 'Grounded answer from the records.' };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
    }
    if (String(url).endsWith('/api/chat/guest')) return new Response(JSON.stringify({ answer: 'University answer', source: 'uploaded_files_all_llm' }));
    return new Response('{}', { status: 404 });
  };
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
});
after(async () => {
  if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  global.fetch = originalFetch; pool.query = originalQuery; pool.connect = originalConnect;
  await database.close(); await pool.end();
});
beforeEach(() => { calls = []; modelMode = 'ok'; process.env.GROQ_API_KEY = 'test-groq-key'; });

test('a student asking about their own risk is answered from EduFusion records, not the university chatbot', async () => {
  route = { intent: 'self', student: null };
  const response = await ask(studentToken(20240002), 'هل أنا في خطر في مساقاتي؟');
  assert.equal(response.status, 200);
  assert.equal(response.body.source, 'edufusion_records');
  assert.equal(response.body.answer, 'Grounded answer from the records.');
  assert.equal(calls.some((c) => c.url.endsWith('/api/chat/guest')), false);
  const records = JSON.parse(modelCalls().at(-1).messages.at(-1).content);
  assert.equal(records.audience, 'self');
  assert.equal(records.records[0].prediction.risk_level, 'HIGH');
  assert.equal(records.records[0].prediction.risk_probability_percent, 82);
  assert.deepEqual(records.records[0].prediction.reasons, ['No assessment submitted yet', 'Very little platform activity']);
});

test('a student cannot read another student\'s records', async () => {
  route = { intent: 'student', student: '20240002' };
  const response = await ask(studentToken(20240001), 'Is student 20240002 at risk?');
  assert.equal(response.body.source, 'edufusion_records');
  assert.match(response.body.answer, /only share your own/);
  assert.equal(modelCalls().length, 1, 'only the routing call; no records are sent to the model');
  assert.doesNotMatch(JSON.stringify(calls), /No assessment submitted yet/);
});

test('an admin asks about a student by ID or by an ambiguous name', async () => {
  route = { intent: 'student', student: '20240002' };
  let response = await ask(adminToken(), 'Is student 20240002 at risk?');
  assert.equal(response.body.student, 20240002);
  const payload = JSON.parse(modelCalls().at(-1).messages.at(-1).content);
  assert.equal(payload.audience, 'staff');
  assert.deepEqual(payload.student, { id: 20240002, name: 'Omar Khalil' });
  route = { intent: 'student', student: 'Omar' };
  response = await ask(adminToken(), 'هل الطالب Omar في خطر؟');
  assert.match(response.body.answer, /أكثر من طالب/);
  assert.match(response.body.answer, /Omar Haddad \(20240003\)/);
  assert.match(response.body.answer, /Omar Khalil \(20240002\)/);
});

test('an admin can list the students at highest risk', async () => {
  route = { intent: 'at_risk_list', student: null };
  const response = await ask(adminToken(), 'Which students are at high risk right now?');
  assert.match(response.body.answer, /\*\*Omar Khalil\*\* \(20240002\) — .*82%/);
  assert.doesNotMatch(response.body.answer, /Sara Ahmad/);
});

test('general questions still go to the university chatbot, without a model call', async () => {
  const response = await ask(studentToken(20240001), 'What programmes can I study?');
  assert.equal(response.body.answer, 'University answer');
  assert.equal(modelCalls().length, 0);
  assert.equal(calls.some((c) => c.url === 'https://final-iug-chat-botv3.onrender.com/api/chat/guest'), true);
});

test('without the model the student still gets their facts, in their language', async () => {
  modelMode = 'down';
  let response = await ask(studentToken(20240002), 'هل أنا في خطر؟');
  assert.match(response.body.answer, /مستوى الخطر مرتفع \(82%\)/);
  delete process.env.GROQ_API_KEY; calls = [];
  response = await ask(studentToken(20240001), 'Am I at risk?');
  assert.match(response.body.answer, /low risk \(12%\)/);
  assert.equal(calls.some((c) => c.url.includes('api.groq.com')), false);
});
