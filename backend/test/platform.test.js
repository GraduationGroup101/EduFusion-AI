const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Readable } = require('node:stream');
const { readForm } = require('../src/routes/questionGenerator');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters';
process.env.DEMO_ADMIN_PASSWORD = 'test-admin-password';
process.env.ADMIN_API_KEY = 'test-provider-key';
const { pool } = require('../src/db');
const { migrate } = require('../scripts/migrate');
const { seed } = require('../scripts/seed');
const { registerStudentWithEnrollment, getStudentBehaviorData } = require('../src/db/queries');
const { verifyStudentPin } = require('../src/lib/studentPin');
const { distributeClicks } = require('../src/db/scenarios');
const store = require('../src/db/appStore');
const app = require('../src/app');
const originalQuery = pool.query;
const originalConnect = pool.connect;
const originalFetch = global.fetch;
let database;
let server;
let providerMode = 'ok';
let providerCalls = [];
let transactionTail = Promise.resolve();
const normalize = (result) => ({ rows: result.rows || [], rowCount: result.rows?.length || result.affectedRows || 0 });
const execute = async (sql, params) => {
  if (!params?.length && sql.split(';').length > 2) return normalize((await database.exec(sql)).at(-1));
  return normalize(await database.query(sql, params));
};
const studentToken = (id=123) => jwt.sign({id_student:id},process.env.JWT_SECRET);
const adminToken = () => jwt.sign({id:1},process.env.JWT_SECRET);
const profile = (id=123) => ({ id_student:id, course_presentation_id:1, pin:'abcd1234', student_name:'Test Student', email:null,
  gender:'M',disability:'N',age_band:'0-35',highest_education:'A Level or Equivalent',imd_band:'50-60%',region:'Unknown',num_of_prev_attempts:0,studied_credits:60,date_registration:0 });
before(async () => {
  database = new PGlite();
  pool.query = execute;
  pool.connect = async () => {
    const previous = transactionTail;
    let release;
    transactionTail = new Promise((resolve) => { release=resolve; });
    await previous;
    return {query:execute,release};
  };
  await migrate(); await migrate(); await seed();
  await registerStudentWithEnrollment(profile());
  await database.query('INSERT INTO student_assessments(enrollment_id,id_assessment,date_submitted,score) VALUES(1,2000000001,30,50)');
  await database.query('INSERT INTO student_vle_events(enrollment_id,id_site,date,sum_click) VALUES(1,2000000001,1,5)');
  global.fetch = async (url, options={}) => {
    providerCalls.push({url:String(url),options});
    if (String(url).includes('/scenario-prediction?')) {
      if (providerMode === 'scenario-invalid') return new Response(JSON.stringify({ detail: 'invalid evidence' }), { status: 422 });
      const evidence = JSON.parse(options.body);
      return new Response(JSON.stringify({ risk_probability: evidence.inputs.latest_tma_score >= 80 ? 0.1 : 0.7,
        risk_level: 'LOW', at_risk: 0, explanation: [], model_confidence: { day_of_course: 60 } }));
    }
    if (String(url).includes('/students/') && String(url).includes('/prediction?')) {
      if (providerMode === 'prediction-timeout') throw Object.assign(new Error('timed out'), { name: 'AbortError' });
      if (providerMode === 'prediction-error') return new Response(JSON.stringify({ detail: 'private database diagnostic' }), { status: 500 });
      if (providerMode === 'prediction-dns') return new Response(JSON.stringify({ detail: '[Errno -2] Name or service not known' }), { status: 500 });
      if (providerMode === 'prediction-invalid') return new Response('invalid json');
      if (providerMode === 'prediction-unauthorized') return new Response(JSON.stringify({ detail: 'private auth diagnostic' }), { status: 401 });
      if (providerMode === 'prediction-forbidden') return new Response(JSON.stringify({ detail: 'private auth diagnostic' }), { status: 403 });
      return new Response(JSON.stringify({ risk_probability: 0.3, risk_level: 'LOW', at_risk: 0, threshold_used: 0.41,
        explanation: [], recommended_action: 'No action needed', model_confidence: { day_of_course: 60 },
        data_completeness: { completeness_pct: 50 } }));
    }
    if(providerMode==='fail') return new Response(JSON.stringify({error:'provider failed'}),{status:503});
    if(providerMode==='unauthorized') return new Response('{}',{status:401});
    if(String(url).endsWith('/jobs') && options.method==='POST') return new Response(JSON.stringify({job_id:'owned-job',status:'queued'}),{status:202});
    if(String(url).endsWith('/jobs'))return new Response(JSON.stringify({jobs:[{job_id:'provider-only-job',status:'completed',request:{youtube_url:'https://youtu.be/lmnopqrstuv'}}]}));
    if(String(url).includes('/transcript')) return new Response('private transcript');
    if(String(url).includes('/jobs/')) return new Response(JSON.stringify({job_id:'owned-job',status:'completed',submitted_at:1}));
    return new Response(JSON.stringify({answer:'answer',status:'ok',risk_probability:0.3,total_students:1}));
  };
  await new Promise((resolve) => { server=app.listen(0,'127.0.0.1',resolve); });
});
after(async () => { if(server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); global.fetch=originalFetch;pool.query=originalQuery;pool.connect=originalConnect;await database.close();await pool.end(); });

test('migrations are repeatable and new student PINs are hashes',async()=>{
  assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM edufusion_schema_migrations')).rows[0].n,10);
  const student=(await database.query('SELECT * FROM students WHERE id_student=123')).rows[0];
  assert.notEqual(student.pin_hash,'abcd1234');assert.equal(await bcrypt.compare('abcd1234',student.pin_hash),true);
  const login=await request(server).post('/api/auth/login').send({username:'123',password:'abcd1234'});
  assert.equal(login.status,200);assert.equal(login.body.user.role,'student');
});

test('registration courses are public and registration creates a usable student session', async () => {
  for (const token of [null, studentToken(), adminToken()]) {
    let call = request(server).get('/api/auth/registration-courses');
    if (token) call = call.set('Authorization', `Bearer ${token}`);
    const courses = await call;
    assert.equal(courses.status, 200);
    assert.equal(courses.body.courses[0].code_module, 'DEMO');
    assert.ok(courses.body.courses[0].assessment_count > 0);
  }
  const registered = await request(server).post('/api/auth/register-student').send(profile(135));
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.role, 'student');
  const auth = `Bearer ${registered.body.token}`;
  assert.equal((await request(server).get('/api/auth/me').set('Authorization', auth)).status, 200);
  const dashboard = await request(server).get('/api/dashboard/student-summary').set('Authorization', auth);
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.totalEnrollments, 1);
  assert.equal((await request(server).post('/api/auth/login').send({ username: '135', password: 'abcd1234' })).status, 200);
});
test('registration rolls back the student if enrollment fails',async()=>{
  await database.query('ALTER TABLE enrollments ADD CONSTRAINT injected_failure CHECK(id_student<>999)');
  await assert.rejects(registerStudentWithEnrollment(profile(999)));
  assert.equal((await database.query('SELECT 1 FROM students WHERE id_student=999')).rows.length,0);
  await database.query('ALTER TABLE enrollments DROP CONSTRAINT injected_failure');
});
test('duplicate registration does not leave extra records',async()=>{
  await assert.rejects(registerStudentWithEnrollment(profile()),{statusCode:409});
  assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM enrollments WHERE id_student=123')).rows[0].n,1);
});
test('legacy PINs upgrade only after a valid login, including long UTF-8 secrets',async()=>{
  const secret='é'.repeat(40)+'x';
  await database.query('INSERT INTO students(id_student,student_name,pin_hash) VALUES(124,$1,$2)',['Legacy',secret]);
  let student=(await database.query('SELECT * FROM students WHERE id_student=124')).rows[0];
  assert.equal(await verifyStudentPin(student,'wrong'),false);
  assert.equal(await verifyStudentPin(student,secret),true);
  student=(await database.query('SELECT * FROM students WHERE id_student=124')).rows[0];
  assert.ok(student.pin_hash.startsWith('bcrypt-sha256$'));
  assert.equal(await verifyStudentPin(student,secret),true);
  assert.equal(await verifyStudentPin(student,'é'.repeat(40)+'y'),false);
  assert.equal(await verifyStudentPin(student,student.pin_hash),false);
});
test('hashes cannot be used as PINs and numeric username prefixes are rejected',async()=>{
  const stored=(await database.query('SELECT pin_hash FROM students WHERE id_student=123')).rows[0].pin_hash;
  assert.equal((await request(server).post('/api/auth/login').send({username:'123',password:stored})).status,401);
  assert.equal((await request(server).post('/api/auth/login').send({username:'123abc',password:'abcd1234'})).status,401);
});

test('legacy hash-prefix character PINs migrate without plaintext fallback for marked hashes', async () => {
  for (const [id, pin] of [[130,'$2legacy'],[131,'bcrypt-sha256$legacy']]) {
    await database.query('INSERT INTO students(id_student,student_name,pin_hash) VALUES($1,$2,$3)', [id,'Legacy prefix',pin]);
    for (let attempt=0;attempt<2;attempt++) {
      const response=await request(server).post('/api/auth/login').send({username:String(id),password:pin});
      assert.equal(response.status,200);
    }
    const row=(await database.query('SELECT pin_hash,pin_format FROM students WHERE id_student=$1',[id])).rows[0];
    assert.equal(row.pin_format,'bcrypt');assert.notEqual(row.pin_hash,pin);
  }
  await database.query("INSERT INTO students(id_student,student_name,pin_hash,pin_format) VALUES(132,'Malformed','$2broken','bcrypt')");
  assert.equal((await request(server).post('/api/auth/login').send({username:'132',password:'$2broken'})).status,401);
});

test('long legacy PINs remain valid on first upgrade and subsequent login', async () => {
  const pin='a'.repeat(1200);
  await database.query('INSERT INTO students(id_student,student_name,pin_hash) VALUES(133,$1,$2)', ['Long legacy',pin]);
  for(let attempt=0;attempt<2;attempt++) assert.equal((await request(server).post('/api/auth/login').send({username:'133',password:pin})).status,200);
  assert.equal((await request(server).post('/api/auth/login').send({username:'133',password:'a'.repeat(1199)+'b'})).status,401);
});

test('invalid Unicode cannot alias a legacy credential or change it', async () => {
  const original='\ufffdabc';
  await database.query('INSERT INTO students(id_student,student_name,pin_hash) VALUES(134,$1,$2)', ['Unicode legacy',original]);
  assert.equal((await request(server).post('/api/auth/login').send({username:'134',password:'\ud800abc'})).status,400);
  assert.equal((await database.query('SELECT pin_hash FROM students WHERE id_student=134')).rows[0].pin_hash,original);
  for(let attempt=0;attempt<2;attempt++) assert.equal((await request(server).post('/api/auth/login').send({username:'134',password:original})).status,200);
});
test('registration rejects nulls, unsafe PIN byte lengths and malformed numbers',async()=>{
  for(const changes of [{pin:null},{pin:'é'.repeat(40)},{id_student:'125junk'},{gender:null}]){
    const response=await request(server).post('/api/auth/register-student').send({...profile(125),...changes});assert.equal(response.status,400);
  }
});
test('a valid session survives a database lookup outage',async()=>{
  pool.query=async()=>{throw Object.assign(new Error('database unavailable'),{code:'23500'});};
  try {const response=await request(server).get('/api/auth/me').set('Authorization',`Bearer ${studentToken()}`);assert.equal(response.status,503);}
  finally{pool.query=execute;}
  assert.equal((await request(server).get('/api/auth/me').set('Authorization',`Bearer ${studentToken()}`)).status,200);
});
test('students cannot access administrative routes or another enrollment',async()=>{
  assert.equal((await request(server).get('/api/admin/clock').set('Authorization',`Bearer ${studentToken()}`)).status,403);
  assert.equal((await request(server).get('/api/dashboard/stats').set('Authorization',`Bearer ${studentToken()}`)).status,403);
  assert.equal((await request(server).put('/api/student/scenarios/999').set('Authorization',`Bearer ${studentToken()}`).send({quiz_clicks:1})).status,404);
});
test('isolated scenarios conserve clicks and never modify academic evidence',async()=>{
  assert.equal(distributeClicks(1,3,60).reduce((sum,event)=>sum+event.clicks,0),1);
  const before=await getStudentBehaviorData(123);
  const response=await request(server).put('/api/student/scenarios/1').set('Authorization',`Bearer ${studentToken()}`).send({quiz_clicks:1,activity_days:3,latest_tma_score:90});
  assert.equal(response.status,200);assert.equal(response.body.scenario.projected.total_clicks,6);assert.equal(response.body.scenario.prediction_available,false);
  assert.deepEqual(await getStudentBehaviorData(123),before);
  const legacy=await request(server).put('/api/student/prediction-data/1').set('Authorization',`Bearer ${studentToken()}`).send({latest_score:100,activity_clicks:50});
  assert.equal(legacy.status,400);
  assert.deepEqual(await getStudentBehaviorData(123),before);
});
test('saved scenario reaches a distinct model call without changing academic evidence or actual prediction cache', async () => {
  const auth = `Bearer ${studentToken()}`;
  const before = await getStudentBehaviorData(123);
  const actualBefore = (await database.query('SELECT * FROM predictions WHERE enrollment_id=1')).rows;
  providerCalls = [];
  const saved = await request(server).put('/api/student/scenarios/1').set('Authorization',auth)
    .send({quiz_clicks:9,activity_days:3,latest_tma_score:95});
  assert.equal(saved.status,200);
  const result = await request(server).get('/api/student/scenarios/1/prediction').set('Authorization',auth);
  assert.equal(result.status,200);
  assert.equal(result.body.hypothetical,true);
  assert.equal(result.body.risk_probability,0.1);
  assert.equal(result.body.based_on_day,60);
  assert.equal(providerCalls.length,1);
  assert.equal(providerCalls[0].options.method,'POST');
  assert.deepEqual(JSON.parse(providerCalls[0].options.body), {
    based_on_day:saved.body.scenario.based_on_day,
    inputs:saved.body.scenario.inputs,
    activity:saved.body.scenario.activity,
  });
  assert.deepEqual(await getStudentBehaviorData(123),before);
  assert.deepEqual((await database.query('SELECT * FROM predictions WHERE enrollment_id=1')).rows,actualBefore);
  assert.equal((await request(server).get('/api/student/scenarios/999/prediction').set('Authorization',auth)).status,404);
  providerMode = 'scenario-invalid';
  try {
    const invalid = await request(server).get('/api/student/scenarios/1/prediction').set('Authorization',auth);
    assert.equal(invalid.status,409);
    assert.doesNotMatch(JSON.stringify(invalid.body),/invalid evidence/);
  } finally {providerMode='ok';}
});
test('scenario delete and learning plan are owner-only and never touch academic evidence or the actual prediction', async () => {
  const owner = `Bearer ${studentToken(136)}`;
  const other = `Bearer ${studentToken()}`;
  const { enrollment_id: enrollment } = await registerStudentWithEnrollment(profile(136));
  await database.query('INSERT INTO student_assessments(enrollment_id,id_assessment,date_submitted,score) VALUES($1,2000000001,31,45)', [enrollment]);
  await database.query('INSERT INTO student_vle_events(enrollment_id,id_site,date,sum_click) VALUES($1,2000000002,2,7)', [enrollment]);
  const path = `/api/student/scenarios/${enrollment}`;
  assert.equal((await request(server).delete(path).set('Authorization', owner)).status, 404);
  assert.equal((await request(server).patch(`${path}/plan`).set('Authorization', owner).send({ adopted: true })).status, 404);
  const saved = await request(server).put(path).set('Authorization', owner).send({ quiz_clicks: 3, activity_days: 2, latest_tma_score: 80, tma_delay_days: 0 });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.scenario.plan, null);
  assert.equal(saved.body.scenario.evidence.latest_tma_score, 45);
  assert.equal(saved.body.scenario.evidence.total_clicks, 7);
  let read = await request(server).get(path).set('Authorization', owner);
  assert.equal(read.body.status.state, 'current');
  assert.deepEqual(read.body.status.reasons, []);
  // Another student sees nothing, cannot delete it and cannot label it.
  assert.equal((await request(server).get(path).set('Authorization', other)).status, 404);
  assert.equal((await request(server).delete(path).set('Authorization', other)).status, 404);
  assert.equal((await request(server).patch(`${path}/plan`).set('Authorization', other).send({ adopted: true })).status, 404);
  assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM edufusion_student_scenarios WHERE enrollment_id=$1', [enrollment])).rows[0].n, 1);
  // The learning plan is a label on the isolated row, not a write to records.
  assert.equal((await request(server).patch(`${path}/plan`).set('Authorization', owner).send({ adopted: 'yes' })).status, 400);
  const evidenceBefore = await getStudentBehaviorData(136);
  const predictionsBefore = (await database.query('SELECT * FROM predictions')).rows;
  const planned = await request(server).patch(`${path}/plan`).set('Authorization', owner).send({ adopted: true });
  assert.equal(planned.status, 200);
  assert.match(planned.body.scenario.plan.adopted_at, /^\d{4}-/);
  assert.deepEqual(planned.body.scenario.inputs, saved.body.scenario.inputs);
  read = await request(server).get(path).set('Authorization', owner);
  assert.ok(read.body.scenario.data.plan.adopted_at);
  assert.equal((await request(server).patch(`${path}/plan`).set('Authorization', owner).send({ adopted: false })).body.scenario.plan, null);
  assert.deepEqual(await getStudentBehaviorData(136), evidenceBefore);
  const removed = await request(server).delete(path).set('Authorization', owner);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.deleted, true);
  read = await request(server).get(path).set('Authorization', owner);
  assert.equal(read.status, 200);
  assert.equal(read.body.scenario, null);
  assert.equal(read.body.status, null);
  assert.equal((await request(server).delete(path).set('Authorization', owner)).status, 404);
  assert.deepEqual(await getStudentBehaviorData(136), evidenceBefore);
  assert.deepEqual((await database.query('SELECT * FROM predictions')).rows, predictionsBefore);
  // The other student's own scenario from the earlier tests is still there.
  assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM edufusion_student_scenarios WHERE id_student=123')).rows[0].n, 1);
});
test('scenario status is stale after the course day moves, invalid when its evidence disappears, and flags changed records', async () => {
  const owner = `Bearer ${studentToken(136)}`;
  const enrollment = (await database.query('SELECT id FROM enrollments WHERE id_student=136')).rows[0].id;
  const path = `/api/student/scenarios/${enrollment}`;
  // The TMA is already submitted, so the scenario must reference the submitted one.
  const saved = await request(server).put(path).set('Authorization', owner).send({ latest_tma_score: 90, tma_delay_days: 1 });
  assert.equal(saved.status, 200);
  providerCalls = [];
  await database.query('UPDATE academic_clocks SET current_day=61');
  try {
    let read = await request(server).get(path).set('Authorization', owner);
    assert.equal(read.body.status.state, 'stale');
    assert.equal(read.body.status.based_on_day, 60);
    assert.equal(read.body.status.current_day, 61);
    const stale = await request(server).get(`${path}/prediction`).set('Authorization', owner);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.status.state, 'stale');
    assert.equal(providerCalls.length, 0);
  } finally { await database.query('UPDATE academic_clocks SET current_day=60'); }
  // A newer TMA submission replaces the one the scenario referenced.
  await database.query("INSERT INTO assessments(id_assessment,course_presentation_id,assessment_type,date,weight) VALUES(2000000003,1,'TMA',50,0) ON CONFLICT DO NOTHING");
  const newer = await database.query('INSERT INTO student_assessments(enrollment_id,id_assessment,date_submitted,score) VALUES($1,2000000003,55,60) RETURNING id', [enrollment]);
  try {
    const read = await request(server).get(path).set('Authorization', owner);
    assert.equal(read.body.status.state, 'invalid');
    assert.match(read.body.status.reasons[0], /newer TMA/);
    const invalid = await request(server).get(`${path}/prediction`).set('Authorization', owner);
    assert.equal(invalid.status, 409);
    assert.equal(invalid.body.status.state, 'invalid');
    assert.equal(providerCalls.length, 0);
  } finally {
    await database.query('DELETE FROM student_assessments WHERE id=$1', [newer.rows[0].id]);
    await database.query('DELETE FROM assessments WHERE id_assessment=2000000003');
  }
  // Same day, same references, but new real activity: evaluate, and say so.
  assert.equal((await request(server).put(path).set('Authorization', owner).send({ forum_clicks: 4 })).status, 200);
  await database.query('INSERT INTO student_vle_events(enrollment_id,id_site,date,sum_click) VALUES($1,2000000003,50,2)', [enrollment]);
  let read = await request(server).get(path).set('Authorization', owner);
  assert.equal(read.body.status.state, 'needs_reevaluation');
  assert.ok(read.body.status.changed.includes('total_clicks'));
  const evaluated = await request(server).get(`${path}/prediction`).set('Authorization', owner);
  assert.equal(evaluated.status, 200);
  assert.equal(evaluated.body.hypothetical, true);
  assert.equal(evaluated.body.status.state, 'needs_reevaluation');
  assert.equal(providerCalls.length, 1);
  // Saving again refreshes the snapshot; a legacy row without a snapshot is simply current.
  assert.equal((await request(server).put(path).set('Authorization', owner).send({ forum_clicks: 4 })).status, 200);
  assert.equal((await request(server).get(path).set('Authorization', owner)).body.status.state, 'current');
  await database.query("UPDATE edufusion_student_scenarios SET data=data-'evidence' WHERE id_student=136");
  read = await request(server).get(path).set('Authorization', owner);
  assert.equal(read.body.status.state, 'current');
  assert.equal((await request(server).delete(path).set('Authorization', owner)).status, 200);
});
test('student prediction validates enrollment, uses the current cache, and forces an upstream refresh', async () => {
  const path = '/api/student/prediction?code_module=DEMO&code_presentation=2026';
  const auth = `Bearer ${studentToken()}`;
  providerCalls = [];
  assert.equal((await request(server).get('/api/student/prediction?code_module=UNKNOWN&code_presentation=2026').set('Authorization', auth)).status, 404);
  assert.equal(providerCalls.length, 0);
  const fresh = await request(server).get(path).set('Authorization', auth);
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.risk_probability, 0.3);
  assert.equal(providerCalls.length, 1);
  assert.match(providerCalls[0].url, /code_module=DEMO&code_presentation=2026/);
  await database.query(`INSERT INTO predictions(enrollment_id,day_of_course,risk_probability,risk_level,at_risk,threshold_used)
    VALUES(1,60,0.2,'LOW',false,0.41)`);
  const cached = await request(server).get(path).set('Authorization', auth);
  assert.equal(cached.status, 200);
  assert.equal(cached.body.cached, true);
  assert.equal(cached.body.risk_probability, 0.2);
  assert.equal(providerCalls.length, 1);
  const forced = await request(server).get(`${path}&force=1`).set('Authorization', auth);
  assert.equal(forced.status, 200);
  assert.equal(forced.body.risk_probability, 0.3);
  assert.equal(providerCalls.length, 2);
});
test('student prediction reports upstream failures safely and logs correlation context', async () => {
  const path = '/api/student/prediction?code_module=DEMO&code_presentation=2026&force=1';
  const auth = `Bearer ${studentToken()}`;
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args);
  try {
    for (const [mode, status] of [['prediction-error', 503], ['prediction-dns', 503], ['prediction-timeout', 504],
      ['prediction-invalid', 502], ['prediction-unauthorized', 502], ['prediction-forbidden', 502]]) {
      providerMode = mode;
      const response = await request(server).get(path).set('Authorization', auth);
      assert.equal(response.status, status, mode);
      assert.match(response.headers['x-request-id'], /^[0-9a-f-]{36}$/);
      assert.match(response.body.error, /Prediction service is temporarily unavailable/);
      assert.doesNotMatch(JSON.stringify(response.body), /private|database|auth diagnostic/);
    }
    assert.equal(logs.length, 6);
    assert.deepEqual(logs.map((entry) => entry[1].category), ['upstream_http', 'database_dns', 'timeout', 'invalid_response', 'upstream_auth', 'upstream_auth']);
    assert.ok(logs.every((entry) => entry[1].code_module === 'DEMO' && entry[1].code_presentation === '2026'));
    assert.ok(logs.every((entry) => entry[1].request_id && entry[1].endpoint && entry[1].upstream));
    assert.doesNotMatch(JSON.stringify(logs), /private database diagnostic|private auth diagnostic/);
  } finally { providerMode = 'ok'; console.error = originalError; }
});
test('chat history persists in PostgreSQL, expires, and isolates account types',async()=>{
  await store.appendExchange({id_student:123},'persistent','hi',{answer:'hello'});
  assert.equal((await store.getHistory({id_student:123},'persistent')).length,2);
  assert.deepEqual(await store.getHistory({id:123},'persistent'),[]);
  await database.query("UPDATE edufusion_chat_history SET expires_at=NOW()-INTERVAL '1 day'");
  assert.deepEqual(await store.getHistory({id_student:123},'persistent'),[]);
});
test('LectureScribe stores creation entitlement and blocks arbitrary jobs and transcripts',async()=>{
  const token=`Bearer ${studentToken()}`;
  let response=await request(server).post('/api/lecture-scribe/jobs').set('Authorization',token).send({youtube_url:'https://youtu.be/abcdefghijk',clean:true,job_id:'injected'});
  assert.equal(response.status,202);
  assert.equal(JSON.parse(providerCalls.at(-1).options.body).job_id,undefined);
  response=await request(server).get('/api/lecture-scribe/jobs').set('Authorization',token);
  assert.equal(response.body.jobs.length,1);
  providerCalls=[];
  for(const path of ['/jobs/unowned','/jobs/owned-job','/jobs/owned-job/transcript?kind=raw','/jobs/owned-job/transcript?kind=cleaned']){
    const denied=await request(server).get(`/api/lecture-scribe${path}`).set('Authorization',`Bearer ${studentToken(124)}`);assert.equal(denied.status,404);
  }
  assert.equal(providerCalls.length,0);
  response=await request(server).get('/api/lecture-scribe/jobs/owned-job/transcript?kind=raw').set('Authorization',token);
  assert.equal(response.status,200);assert.equal(response.text,'private transcript');
  response=await request(server).get('/api/lecture-scribe/jobs').set('Authorization',`Bearer ${adminToken()}`);
  assert.equal(response.body.scope,'all');
  assert.deepEqual(new Set(response.body.jobs.map(job=>job.job_id)),new Set(['owned-job','provider-only-job']));
  response=await request(server).get('/api/lecture-scribe/jobs/provider-only-job/transcript?kind=raw').set('Authorization',`Bearer ${adminToken()}`);
  assert.equal(response.status,200);assert.equal(response.text,'private transcript');
  providerMode='fail';
  response=await request(server).get('/api/lecture-scribe/jobs').set('Authorization',`Bearer ${adminToken()}`);
  assert.equal(response.status,200);assert.equal(response.body.jobs[0].job_id,'owned-job');assert.ok(response.body.warning);
  providerMode='ok';
});
test('clock commands replay safely and keep success when only prediction regeneration fails',async()=>{
  providerMode='fail';
  const command=()=>request(server).post('/api/admin/clock/tick-all').set('Authorization',`Bearer ${adminToken()}`).set('Idempotency-Key','same-command').send({days:1});
  const first=await command();const second=await command();
  assert.equal(first.status,200);assert.equal(first.body.warnings.length,1);assert.equal(second.body.replayed,true);
  assert.equal((await database.query('SELECT current_day FROM academic_clocks')).rows[0].current_day,61);
  const conflict=await request(server).post('/api/admin/clock/tick-all').set('Authorization',`Bearer ${adminToken()}`).set('Idempotency-Key','same-command').send({days:2});
  assert.equal(conflict.status,409);providerMode='ok';
});
test('provider authorization errors do not become user-session 401s',async()=>{
  providerMode='unauthorized';
  const response=await request(server).get('/api/lecture-scribe/health').set('Authorization',`Bearer ${studentToken()}`);
  assert.equal(response.status,502);providerMode='ok';
});
test('question upload validates multipart size, file types and counts before generation',async()=>{
  const auth=`Bearer ${studentToken()}`;providerCalls=[];
  for(const withLength of [true,false]) {
    const stream=Readable.from([Buffer.alloc(4*1024*1024+1)]);
    stream.headers={'content-type':'multipart/form-data; boundary=test',...(withLength?{'content-length':String(4*1024*1024+1)}:{})};
    await assert.rejects(readForm(stream),{statusCode:413});
  }
  assert.equal(providerCalls.length,0);
  let response=await request(server).post('/api/question-generator/generate').set('Authorization',auth).attach('file',Buffer.from('notes'),{filename:'notes.exe'}).field('num_mcq','1').field('num_tf','0').field('num_essay','0');
  assert.equal(response.status,400);assert.equal(providerCalls.length,0);
  response=await request(server).post('/api/question-generator/generate').set('Authorization',auth).attach('file',Buffer.from('notes'),{filename:'notes.txt'}).field('num_mcq','1').field('num_tf','0').field('num_essay','0');
  assert.equal(response.status,200);assert.equal(providerCalls.at(-1).options.body.get('num_mcq'),'1');
});

test('scenario save, evaluation and delete preserve real scores; only explicit apply updates atomically',async()=>{
  const {enrollment_id:id}=await registerStudentWithEnrollment(profile(171));
  const auth=`Bearer ${studentToken(171)}`,path=`/api/student/scenarios/${id}`;
  await database.query('INSERT INTO student_assessments(enrollment_id,id_assessment,date_submitted,score) VALUES($1,2000000001,30,60)',[id]);
  const actual=async()=>Number((await database.query('SELECT score FROM student_assessments WHERE enrollment_id=$1',[id])).rows[0].score);
  const save=async()=>request(server).put(path).set('Authorization',auth).send({latest_tma_score:90,quiz_clicks:9,activity_days:3});
  let saved=await save();assert.equal(saved.status,200);
  assert.equal((await request(server).get(`${path}/prediction`).set('Authorization',auth)).status,200);
  assert.equal(await actual(),60);
  let reloaded=(await request(server).get(path).set('Authorization',auth)).body.scenario.data;
  assert.equal(reloaded.inputs.latest_tma_score,90);assert.equal(reloaded.prediction.risk_probability,0.1);assert.ok(reloaded.predicted_at);
  assert.equal((await request(server).delete(path).set('Authorization',auth)).status,200);assert.equal(await actual(),60);
  saved=await save();const revision=saved.body.scenario.revision;
  assert.equal((await request(server).post(`${path}/actual`).set('Authorization',auth).send({confirm:true,revision})).status,409);
  await request(server).get(`${path}/prediction`).set('Authorization',auth);
  assert.equal((await request(server).post(`${path}/actual`).set('Authorization',auth).send({revision})).status,400);
  assert.equal((await request(server).post(`${path}/actual`).set('Authorization',`Bearer ${studentToken()}`).send({confirm:true,revision})).status,404);
  assert.equal(await actual(),60);
  const applied=await request(server).post(`${path}/actual`).set('Authorization',auth).send({confirm:true,revision});
  assert.equal(applied.status,200,JSON.stringify(applied.body));assert.equal(await actual(),90);
  const clicks=async()=>Number((await database.query('SELECT SUM(sum_click) AS n FROM student_vle_events WHERE enrollment_id=$1',[id])).rows[0].n);
  assert.equal(await clicks(),9);
  assert.equal((await request(server).post(`${path}/actual`).set('Authorization',auth).send({confirm:true,revision})).body.already_applied,true);
  assert.equal(await clicks(),9);
  const audit=(await database.query('SELECT before_data FROM edufusion_scenario_applications WHERE revision=$1',[revision])).rows[0];
  assert.equal(Number(audit.before_data.submissions[0].score),60);
  assert.equal(Number((await database.query('SELECT risk_probability FROM predictions WHERE enrollment_id=$1',[id])).rows[0].risk_probability),0.1);
  await request(server).delete(path).set('Authorization',auth);assert.equal(await actual(),90);
});

test('Save as Actual rejects changed evidence and rolls back academic writes if prediction persistence fails',async()=>{
  const {enrollment_id:id}=await registerStudentWithEnrollment(profile(172));
  const auth=`Bearer ${studentToken(172)}`,path=`/api/student/scenarios/${id}`;
  await database.query('INSERT INTO student_assessments(enrollment_id,id_assessment,date_submitted,score) VALUES($1,2000000001,30,60)',[id]);
  const saved=await request(server).put(path).set('Authorization',auth).send({latest_tma_score:90,quiz_clicks:9});
  const revision=saved.body.scenario.revision;
  await request(server).get(`${path}/prediction`).set('Authorization',auth);
  await database.query('UPDATE student_assessments SET score=61 WHERE enrollment_id=$1',[id]);
  assert.equal((await request(server).post(`${path}/actual`).set('Authorization',auth).send({confirm:true,revision})).status,409);
  await database.query('UPDATE student_assessments SET score=60 WHERE enrollment_id=$1',[id]);
  const connect=pool.connect;
  pool.connect=async()=>{const client=await connect();return {...client,query:async(sql,params)=>{if(sql.startsWith('INSERT INTO predictions'))throw new Error('injected prediction failure');return client.query(sql,params);}};};
  try {assert.equal((await request(server).post(`${path}/actual`).set('Authorization',auth).send({confirm:true,revision})).status,503);}
  finally{pool.connect=connect;}
  assert.equal(Number((await database.query('SELECT score FROM student_assessments WHERE enrollment_id=$1',[id])).rows[0].score),60);
  assert.equal((await database.query('SELECT * FROM student_vle_events WHERE enrollment_id=$1',[id])).rows.length,0);
  assert.equal((await database.query('SELECT * FROM edufusion_scenario_applications WHERE revision=$1',[revision])).rows.length,0);
});
