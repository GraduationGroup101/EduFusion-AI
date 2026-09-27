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
    if(providerMode==='fail') return new Response(JSON.stringify({error:'provider failed'}),{status:503});
    if(providerMode==='unauthorized') return new Response('{}',{status:401});
    if(String(url).endsWith('/jobs') && options.method==='POST') return new Response(JSON.stringify({job_id:'owned-job',status:'queued'}),{status:202});
    if(String(url).includes('/transcript')) return new Response('private transcript');
    if(String(url).includes('/jobs/')) return new Response(JSON.stringify({job_id:'owned-job',status:'completed',submitted_at:1}));
    return new Response(JSON.stringify({answer:'answer',status:'ok',risk_probability:0.3,total_students:1}));
  };
  await new Promise((resolve) => { server=app.listen(0,'127.0.0.1',resolve); });
});
after(async () => { if(server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); global.fetch=originalFetch;pool.query=originalQuery;pool.connect=originalConnect;await database.close();await pool.end(); });

test('migrations are repeatable and new student PINs are hashes',async()=>{
  assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM edufusion_schema_migrations')).rows[0].n,4);
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
  assert.deepEqual(response.body.jobs,[]);
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
