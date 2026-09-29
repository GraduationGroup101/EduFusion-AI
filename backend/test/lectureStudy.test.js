const assert = require('node:assert/strict');
const {before,after,test} = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const {PGlite} = require('@electric-sql/pglite');
process.env.JWT_SECRET='test-only-secret-with-at-least-32-characters';
process.env.LECTURE_STUDY_ENABLED='true';
process.env.LEARNING_DATABASE_URL='postgresql://test:test@localhost/learning';
process.env.NODE_ENV='test';
const core = require('../src/db');
const db = require('../src/lectureStudy/database');
const store = require('../src/lectureStudy/store');
const {source,publicQuiz,grade} = require('../src/lectureStudy/validation');
const {migrate} = require('../scripts/migrateLearning');
const {migrate:coreMigrate} = require('../scripts/migrate');
const app = require('../src/app');
const snapshot=require('../scripts/backupLearning');
let academic,learning,server,capacity=1000;
let tail=Promise.resolve();
const original={query:core.pool.query,connect:core.pool.connect,studyQuery:db.query,transaction:db.transaction};
const execute = (database) => async (sql,params=[]) => {
  if (sql.includes('pg_database_size')) return {rows:[{bytes:capacity}],rowCount:1};
  if (!params.length && sql.split(';').length>2) {
    const results=await database.exec(sql);const result=results.at(-1);
    return {rows:result.rows||[],rowCount:result.rows?.length||result.affectedRows||0};
  }
  const result=await database.query(sql,params);
  return {rows:result.rows||[],rowCount:result.rows?.length||result.affectedRows||0};
};
const token = (id=10) => 'Bearer '+jwt.sign({id_student:id},process.env.JWT_SECRET);
const call = (method,url,id=10) => request(server)[method]('/api/lecture-study'+url).set('Authorization',token(id));
const newLecture = (video='abcdefghijk',key='lecture-a',id=10) => call('post','/lectures',id).set('Idempotency-Key',key).send({youtube_url:'https://youtu.be/'+video,language:'auto'});
const readyResult = () => ({summary:'A grounded lecture summary',sections:[{id:'s001',title:'Networking',summary:'Packets and routes',citations:['c0001']}],
  concepts:['Networks'],chunks:[{id:'c0001',text:'Packets travel along routes.',section:'s001',ordinal:0,embedding:null}]});
const fixtureQuestions = () => [
  {id:'q001',type:'mcq',prompt:'How are packets transmitted?',choices:['Routes','Trees','Cars','Clouds'],answer:0,explanation:'Packets use routes.',concept:'Networks',citations:['c0001'],rubric:[]},
  {id:'q002',type:'tf',prompt:'Packets use routes.',choices:[],answer:true,explanation:'The lecture states this.',concept:'Networks',citations:['c0001'],rubric:[]},
  {id:'q003',type:'essay',prompt:'Explain routing.',choices:[],answer:'Routes connect endpoints.',explanation:'Routing selects paths.',concept:'Networks',citations:['c0001'],rubric:['Explain paths']},
];
before(async () => {
  academic=await PGlite.create();learning=academic;
  core.pool.query=execute(academic);
  core.pool.connect=async()=>({query:core.pool.query,release(){}});
  db.query=execute(learning);
  db.transaction=async(work)=>{
    const previous=tail;let release;tail=new Promise((resolve)=>{release=resolve;});await previous;
    try{await db.query('BEGIN');const result=await work({query:db.query});await db.query('COMMIT');return result;}
    catch(error){await db.query('ROLLBACK');throw error;}finally{release();}
  };
  await coreMigrate();await migrate();await migrate();
  await academic.query("INSERT INTO students(id_student,student_name,pin_hash) VALUES(10,'First','hash'),(11,'Second','hash'),(12,'Admin visibility fixture','hash')");
  await academic.query("INSERT INTO app_users(id,username,password_hash,role) VALUES(1,'Test Admin','hash','admin'),(2,'Test Advisor','hash','advisor')");
  await academic.query("INSERT INTO course_presentations(code_module,code_presentation,module_presentation_length) VALUES('AAA','2026J',200)");
  await academic.query('INSERT INTO academic_clocks(course_presentation_id,current_day,max_day) VALUES(1,30,200)');
  await academic.query('INSERT INTO enrollments(id_student,course_presentation_id) VALUES(10,1),(11,1)');
  await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});
});
after(async()=>{
  if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  core.pool.query=original.query;core.pool.connect=original.connect;db.query=original.studyQuery;db.transaction=original.transaction;
  await academic.close();await core.pool.end();
});
test('learning migrations are isolated and repeatable; disabled feature leaves old endpoints available',async()=>{
  assert.equal((await academic.query('SELECT COUNT(*)::int n FROM edufusion_schema_migrations')).rows[0].n,6);
  assert.equal((await learning.query('SELECT COUNT(*)::int n FROM study_schema_migrations')).rows[0].n,3);
  process.env.LECTURE_STUDY_ENABLED='false';
  try{
    const status=await call('get','/status');assert.equal(status.body.enabled,false);
    assert.equal((await newLecture()).status,503);
    assert.equal((await request(server).get('/api/health')).status,200);
  }finally{process.env.LECTURE_STUDY_ENABLED='true';}
});
test('canonical sources reject arbitrary URLs and alias URL variations',()=>{
  const a=source({youtube_url:'https://youtu.be/abcdefghijk?t=20'});
  const b=source({youtube_url:'https://www.youtube.com/watch?v=abcdefghijk&list=private'});
  assert.equal(a.source_key,b.source_key);
  for(const url of ['http://youtube.com/watch?v=abcdefghijk','https://evil.example/abcdefghijk','https://youtube.com.evil.example/watch?v=abcdefghijk','https://youtube.com/watch?v=bad']){
    assert.throws(()=>source({youtube_url:url}),{statusCode:400});
  }
});
test('only administrators can read the global lecture catalogue without gaining private student access',async()=>{
  const created=await newLecture('adminview01','admin-view-source',12);
  const id=created.body.lecture.id;
  await store.complete(await store.claimJob('admin-view-worker'),readyResult());
  const admin=method=>request(server)[method]('/api/lecture-study/admin/lectures').set('Authorization','Bearer '+jwt.sign({id:1},process.env.JWT_SECRET));
  assert.equal((await call('get','/admin/lectures')).status,403);
  assert.equal((await request(server).get('/api/lecture-study/admin/lectures').set('Authorization','Bearer '+jwt.sign({id:2},process.env.JWT_SECRET))).status,403);
  const list=await admin('get');assert.equal(list.status,200);assert.ok(list.body.lectures.some(lecture=>lecture.id===id));
  const response=await request(server).get('/api/lecture-study/admin/lectures/'+id).set('Authorization','Bearer '+jwt.sign({id:1},process.env.JWT_SECRET));
  assert.equal(response.status,200);assert.equal(response.body.lecture.summary,readyResult().summary);
  assert.equal(response.body.lecture.jobs,undefined);assert.equal(response.body.lecture.owner_key,undefined);
  assert.equal((await request(server).get('/api/lecture-study/lectures/'+id+'/messages').set('Authorization','Bearer '+jwt.sign({id:1},process.env.JWT_SECRET))).status,404);
});
test('creation is durable and idempotent; another student gets an independent membership',async()=>{
  const first=await newLecture();assert.equal(first.status,202);
  const second=await newLecture();assert.equal(second.body.lecture.id,first.body.lecture.id);assert.equal(second.body.job.id,first.body.job.id);
  assert.equal((await call('post','/lectures').set('Idempotency-Key','lecture-a').send({youtube_url:'https://youtu.be/12345678901'})).status,409);
  const shared=await newLecture('abcdefghijk','lecture-b',11);
  assert.equal(shared.body.lecture.id,first.body.lecture.id);assert.notEqual(shared.body.job.id,first.body.job.id);
  assert.equal(shared.body.job.owner_key,undefined);
  const missing=await call('get','/jobs/'+first.body.job.id,11);assert.equal(missing.status,404);
});
test('foreign lecture, transcript, quiz and job identifiers fail closed',async()=>{
  const privateLecture=await newLecture('12345678901','private-lecture');
  const id=privateLecture.body.lecture.id;
  for(const endpoint of ['/lectures/'+id,'/lectures/'+id+'/messages','/lectures/'+id+'/quizzes','/lectures/'+id+'/attempts','/lectures/'+id+'/recommendations']){
    assert.equal((await call('get',endpoint,11)).status,404);
  }
  assert.equal((await call('post','/lectures/'+id+'/messages',11).set('Idempotency-Key','foreign-chat').send({question:'steal'})).status,404);
  assert.equal((await call('post','/import',11).set('Idempotency-Key','foreign-import').send({job_id:'other-provider-job'})).status,404);
});
test('only owned enrollments can be linked and quotas do not consume shared ready content',async()=>{
  const denied=await call('post','/lectures').set('Idempotency-Key','foreign-enrollment').send({youtube_url:'https://youtu.be/XYZ12345678',enrollment_id:2});
  assert.equal(denied.status,404);
  assert.equal((await newLecture('XYZ12345678','third-new')).status,429);
});
test('visibility leases recover jobs and reject stale publishers',async()=>{
  const job=await store.claimJob('worker-one');
  assert.equal(job.kind,'prepare');
  assert.equal(await store.claimJob('worker-two')!==null,true); // separate queued lecture
  await learning.query("UPDATE study_jobs SET lease_until=NOW()-INTERVAL '1 minute' WHERE id=$1",[job.id]);
  const recovered=await store.claimJob('worker-three');
  assert.equal(recovered.id,job.id);assert.notEqual(recovered.lease_token,job.lease_token);
  await assert.rejects(store.complete(job,readyResult()),{statusCode:409});
  await store.complete(recovered,readyResult());
  const own=await store.getLecture({id_student:10},job.lecture_id);assert.equal(own.status,'ready');
  const other=await store.getLecture({id_student:11},job.lecture_id);assert.equal(other.status,'ready');
});
test('chat context, histories and quota remain scoped to owner and lecture',async()=>{
  const lecture=(await store.listLectures({id_student:10})).find(item=>item.status==='ready');
  const response=await call('post','/lectures/'+lecture.id+'/messages').set('Idempotency-Key','chat-a').send({question:'What is routing?'});
  assert.equal(response.status,202);
  const conflict=await call('post','/lectures/'+lecture.id+'/messages').set('Idempotency-Key','chat-b').send({question:'Another question'});
  assert.equal(conflict.status,409);
  const job=await store.claimJob('chat-worker');
  assert.equal(job.kind,'chat');
  const context=await store.workerContext(job);assert.equal(context.history.length,0);
  await store.complete(job,{answer:'Packets follow routes.',citations:['c0001']});
  const own=(await call('get','/lectures/'+lecture.id+'/messages')).body.messages;
  const other=(await call('get','/lectures/'+lecture.id+'/messages',11)).body.messages;
  assert.equal(own.length,1);assert.equal(own[0].answer,'Packets follow routes.');assert.equal(other.length,0);
  const replay=await call('post','/lectures/'+lecture.id+'/messages').set('Idempotency-Key','chat-a').send({question:'What is routing?'});
  assert.equal(replay.body.job.id,response.body.job.id);
});
test('quiz answer keys stay server-side and objective attempts are graded and replayed atomically',async()=>{
  const lecture=(await store.listLectures({id_student:10})).find(item=>item.status==='ready');
  const created=await call('post','/lectures/'+lecture.id+'/quizzes').set('Idempotency-Key','quiz-a').send({mcq:1,tf:1,essay:1});
  assert.equal(created.status,202);
  const job=await store.claimJob('quiz-worker');assert.equal(job.kind,'quiz');
  await store.complete(job,{questions:fixtureQuestions()});
  const quiz=(await call('get','/quizzes/'+job.id)).body.quiz;
  for(const question of quiz.questions){assert.equal(question.answer,undefined);assert.equal(question.explanation,undefined);assert.equal(question.rubric,undefined);}
  assert.equal((await call('get','/quizzes/'+job.id,11)).status,404);
  const answers={q001:0,q002:false,q003:'My explanation'};
  const submitted=await call('post','/quizzes/'+job.id+'/attempts').set('Idempotency-Key','attempt-a').send({answers});
  assert.equal(submitted.status,200);assert.equal(submitted.body.attempt.score,1);assert.equal(submitted.body.attempt.total,2);
  assert.equal(submitted.body.attempt.feedback[2].correct,null);
  const replay=await call('post','/quizzes/'+job.id+'/attempts').set('Idempotency-Key','attempt-a').send({answers:{q003:'My explanation',q002:false,q001:0}});
  assert.equal(replay.body.attempt.id,submitted.body.attempt.id);
  const changed=await call('post','/quizzes/'+job.id+'/attempts').set('Idempotency-Key','attempt-a').send({answers:{q001:1}});
  assert.equal(changed.status,409);
  assert.equal((await academic.query('SELECT COUNT(*)::int n FROM student_assessments')).rows[0].n,0);
  assert.equal(publicQuiz({questions:fixtureQuestions()}).questions[0].answer,undefined);
  assert.throws(()=>grade(fixtureQuestions(),{q001:'0'}),{statusCode:400});
});
test('storage budget refuses new AI work while existing content remains readable',async()=>{
  const lecture=(await store.listLectures({id_student:10})).find(item=>item.status==='ready');
  capacity=500*1024*1024;
  try{
    const response=await call('post','/lectures/'+lecture.id+'/messages').set('Idempotency-Key','full-storage').send({question:'Explain routing'});
    assert.equal(response.status,429);assert.equal((await call('get','/lectures/'+lecture.id)).status,200);
  }finally{capacity=1000;}
});
test('revoking a membership cancels queued work and rejects result publication',async()=>{
  const lecture=(await store.listLectures({id_student:10})).find(item=>item.status==='ready');
  await store.enqueue({id_student:10},lecture.id,'chat','revoke-message',{question:'Explain packets'});
  const job=await store.claimJob('revocation-worker');
  await store.removeLecture({id_student:10},lecture.id);
  await assert.rejects(store.complete(job,{answer:'Should never publish',citations:['c0001']}),{statusCode:404});
  assert.equal((await call('get','/lectures/'+lecture.id)).status,404);
  assert.equal((await call('get','/lectures/'+lecture.id,11)).status,200);
});
test('the independent worker never imports or contacts the original chatbot',async()=>{
  const worker=await fs.readFile(path.join(__dirname,'../scripts/lectureStudyWorker.js'),'utf8');
  const engine=await fs.readFile(path.join(__dirname,'../../services/lecture-study/engine.py'),'utf8');
  assert.equal(/CHATBOT_API_URL|final-iug|\/api\/chat\/guest/.test(worker+engine),false);
});

test('course recommendations read only the current owned prediction and never change academic evidence',async()=>{
  const lecture=(await store.listLectures({id_student:11})).find(item=>item.status==='ready');
  const linked=await call('post','/lectures',11).set('Idempotency-Key','owned-course-link').send({youtube_url:lecture.youtube_url,enrollment_id:2});
  assert.equal(linked.status,200);
  await academic.query("INSERT INTO predictions(enrollment_id,day_of_course,risk_probability,risk_level,at_risk,recommended_action) VALUES(2,30,0.8,'high',true,'Review networking fundamentals')");
  const before=JSON.stringify((await academic.query('SELECT * FROM predictions')).rows);
  const recommendations=await call('get','/lectures/'+lecture.id+'/recommendations',11);
  assert.equal(recommendations.status,200);assert.equal(recommendations.body.course.id,2);
  assert.equal(recommendations.body.prediction.risk_level,'high');
  assert.equal(recommendations.body.prediction.recommended_action,'Review networking fundamentals');
  assert.equal(recommendations.body.academic_records_changed,false);
  assert.equal(JSON.stringify((await academic.query('SELECT * FROM predictions')).rows),before);
  assert.equal((await academic.query('SELECT COUNT(*)::int n FROM student_assessments')).rows[0].n,0);
});

test('malformed AI output and revoked chat results cannot publish partial artifacts',async()=>{
  const lecture=(await store.listLectures({id_student:11})).find(item=>item.status==='ready');
  await store.enqueue({id_student:11},lecture.id,'chat','invalid-citation',{question:'Explain DNS'});
  const job=await store.claimJob('contract-worker');
  await assert.rejects(store.complete(job,{answer:'Unsupported',citations:['foreign-chunk']}));
  assert.equal((await store.getJob({id_student:11},job.id)).status,'running');
  assert.equal((await store.messages({id_student:11},lecture.id))[0].answer,null);
  await store.clearMessages({id_student:11},lecture.id);
  await assert.rejects(store.complete(job,{answer:'Late',citations:['c0001']}),{statusCode:409});
  assert.equal((await store.messages({id_student:11},lecture.id)).length,0);
});

test('exhausted leases become retryable failures and manual retry budget is enforced',async()=>{
  const stranded=(await learning.query("SELECT * FROM study_jobs WHERE kind='prepare' AND status='running' LIMIT 1")).rows[0];
  await learning.query("UPDATE study_jobs SET attempts=3,lease_until=NOW()-INTERVAL '1 minute' WHERE id=$1",[stranded.id]);
  await store.claimJob('recovery-worker');
  assert.equal((await store.getJob({id_student:10},stranded.id)).status,'failed');
  await store.retry({id_student:10},stranded.id);
  const job=await store.claimJob('checkpoint-worker',true);
  await store.preparationProgress(job,{chunks:readyResult().chunks,sections:readyResult().sections});
  const resumed=await store.workerContext(job);
  assert.equal(resumed.chunks.length,1);assert.equal(resumed.lecture.sections.length,1);
  await learning.query("UPDATE study_jobs SET status='failed',retry_count=2,lease_token=NULL WHERE id=$1",[job.id]);
  await assert.rejects(store.retry({id_student:10},job.id),{statusCode:429});
  await assert.rejects(store.preparationProgress(job,{sections:[]}),{statusCode:409});
});

test('50 accounts reuse one prepared lecture without sharing histories or creating AI work',async()=>{
  const lecture=(await store.listLectures({id_student:11})).find(item=>item.status==='ready');
  await academic.query("INSERT INTO students(id_student,student_name,pin_hash) SELECT n,'Load fixture','hash' FROM generate_series(1000,1049) n");
  const before=(await learning.query("SELECT COUNT(*)::int n FROM study_jobs WHERE kind='prepare' AND stage<>'linked'")).rows[0].n;
  const video=new URL(lecture.youtube_url).searchParams.get('v');
  const results=await Promise.all(Array.from({length:50},(_,index)=>newLecture(video,'load-'+index,1000+index)));
  assert.equal(results.every(result=>result.status===200),true);
  assert.equal(new Set(results.map(result=>result.body.lecture.id)).size,1);
  assert.equal(new Set(results.map(result=>result.body.job.id)).size,50);
  assert.equal((await learning.query("SELECT COUNT(*)::int n FROM study_jobs WHERE kind='prepare' AND stage<>'linked'")).rows[0].n,before);
  const histories=await Promise.all(Array.from({length:50},(_,index)=>call('get','/lectures/'+lecture.id+'/messages',1000+index)));
  assert.equal(histories.every(result=>result.body.messages.length===0),true);
});

test('shared queued preparation survives the original member leaving',async()=>{
  const a=await newLecture('LOADshared1','shared-remove-a',1000);
  const b=await newLecture('LOADshared1','shared-remove-b',1001);
  assert.equal(a.status,202);assert.equal(b.status,202);
  await store.removeLecture({id_student:1000},a.body.lecture.id);
  const shared=await store.getLecture({id_student:1001},a.body.lecture.id);
  assert.equal(shared.jobs.some(job=>job.kind==='prepare'&&job.status==='queued'),true);
  const next=await store.claimJob('shared-successor',true);
  assert.equal(next.owner_key,'student:1001');
  await store.complete(next,readyResult());
  assert.equal((await store.getLecture({id_student:1001},a.body.lecture.id)).status,'ready');
});

test('daily chat and quiz budgets also apply after completed work',async()=>{
  const lecture=(await store.listLectures({id_student:11})).find(item=>item.status==='ready');
  for(const [kind,count] of [['chat',50],['quiz',10]]){
    await learning.query("INSERT INTO study_usage(owner_key,day,kind,requests) VALUES('student:11',(NOW() AT TIME ZONE 'UTC')::date,$1,$2) ON CONFLICT(owner_key,day,kind) DO UPDATE SET requests=EXCLUDED.requests",[kind,count]);
    await learning.query("INSERT INTO study_jobs(id,owner_key,lecture_id,version,kind,request_key,status) SELECT gen_random_uuid(),'student:11',$1,1,$2,'daily-'||$2||'-'||n,'completed' FROM generate_series(1,$3) n",[lecture.id,kind,count]);
    const response=await call('post','/lectures/'+lecture.id+(kind==='chat'?'/messages':'/quizzes'),11).set('Idempotency-Key','over-daily-'+kind).send(kind==='chat'?{question:'More'}:{mcq:1,tf:0,essay:0});
    assert.equal(response.status,429);
  }
  await store.clearMessages({id_student:11},lecture.id);
  const afterClear=await call('post','/lectures/'+lecture.id+'/messages',11).set('Idempotency-Key','after-clear-quota').send({question:'Attempt to bypass daily limit'});
  assert.equal(afterClear.status,429);
  assert.equal((await learning.query("SELECT COUNT(*)::int n FROM study_jobs WHERE owner_key='student:11' AND kind='chat' AND lecture_id=$1",[lecture.id])).rows[0].n,0);
});

test('an imported transcript replay works even when its provider later goes offline',async()=>{
  const lecture=(await store.listLectures({id_student:11})).find(item=>item.status==='ready');
  await require('../src/db/appStore').saveJob({id_student:11},{job_id:'legacy-owned-fixture',status:'completed',request:{youtube_url:lecture.youtube_url,clean:true}});
  const originalFetch=global.fetch;let calls=0;
  global.fetch=async(url)=>{calls++;return new Response(String(url).includes('/transcript?')?'Packets travel on routes.':JSON.stringify({status:'completed'}),{status:200});};
  try{
    const first=await call('post','/import',11).set('Idempotency-Key','import-replay').send({job_id:'legacy-owned-fixture'});
    assert.equal(first.status,200);assert.equal(calls,2);
    global.fetch=async()=>{calls++;throw Error('Provider offline');};
    const replay=await call('post','/import',11).set('Idempotency-Key','import-replay').send({job_id:'legacy-owned-fixture'});
    assert.equal(replay.status,200);assert.equal(replay.body.job.id,first.body.job.id);assert.equal(calls,2);
  }finally{global.fetch=originalFetch;}
});

test('encrypted backup restores learning data atomically and rejects tampering and nonempty targets',async()=>{
  process.env.LEARNING_BACKUP_KEY=Buffer.alloc(32,7).toString('base64');
  const data=await snapshot.backup();
  assert.equal(data.includes(Buffer.from('Packets travel')),false);
  const decoded=snapshot.decrypt(data);
  assert.equal(Object.hasOwn(decoded.tables,'students'),false);
  assert.equal(decoded.tables.study_usage.every(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.day)),true);
  await assert.rejects(snapshot.restore(data),/empty migrated/);
  const damaged=Buffer.from(data);damaged[damaged.length-1]^=1;
  await assert.rejects(snapshot.restore(damaged));
  const studentCount=(await academic.query('SELECT COUNT(*)::int n FROM students')).rows[0].n;
  const before=(await learning.query('SELECT COUNT(*)::int n FROM study_members')).rows[0].n;
  for(const table of [...snapshot.tables].reverse())await learning.query('DELETE FROM '+table);
  const report=await snapshot.restore(data);
  assert.equal(report.rows.study_members,before);
  assert.equal((await learning.query('SELECT COUNT(*)::int n FROM study_members')).rows[0].n,before);
  assert.equal((await academic.query('SELECT COUNT(*)::int n FROM students')).rows[0].n,studentCount);
  assert.equal((await learning.query("SELECT COUNT(*)::int n FROM study_jobs WHERE status='running'")).rows[0].n,0);
});

test('an administrator can explicitly import a provider-only lecture while student imports remain scoped',async()=>{
  const lecture=(await store.listLectures({id_student:11})).find(item=>item.status==='ready');
  const saved=require('../src/db/appStore'),originalFetch=global.fetch;let calls=0;
  const adminToken='Bearer '+jwt.sign({id:1},process.env.JWT_SECRET);
  const importLecture=()=>request(server).post('/api/lecture-study/import').set('Authorization',adminToken)
    .set('Idempotency-Key','admin-provider-import').send({job_id:'provider-only-admin-fixture',youtube_url:'https://evil.example/ignored'});
  global.fetch=async(url)=>{calls++;return new Response(String(url).includes('/transcript?')?'Packets travel on routes.':
    JSON.stringify({status:'completed',request:{youtube_url:lecture.youtube_url,clean:true}}),{status:200});};
  try{
    assert.equal((await call('post','/import',11).set('Idempotency-Key','student-provider-import').send({job_id:'provider-only-admin-fixture'})).status,404);
    assert.equal(calls,0);
    const first=await importLecture();assert.equal(first.status,200);assert.equal(first.body.lecture.id,lecture.id);assert.equal(calls,2);
    assert.equal(await saved.ownsJob({id:1,role:'admin'},'provider-only-admin-fixture'),true);
    assert.equal((await request(server).get('/api/lecture-study/lectures/'+lecture.id+'/quizzes').set('Authorization',adminToken)).body.quizzes.length,0);
    global.fetch=async()=>{calls++;throw Error('Provider offline');};
    const replay=await importLecture();assert.equal(replay.status,200);assert.equal(replay.body.job.id,first.body.job.id);assert.equal(calls,2);
  }finally{global.fetch=originalFetch;}
});
