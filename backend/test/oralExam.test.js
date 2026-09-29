const assert=require('node:assert/strict');
const {before,after,test}=require('node:test');
const {once}=require('node:events');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const request=require('supertest');
const jwt=require('jsonwebtoken');
const WebSocket=require('ws');
process.env.JWT_SECRET='oral-exam-isolated-test-secret-at-least-32';
process.env.NODE_ENV='test';
process.env.ORAL_EXAM_ENABLED='true';
for(const key of ['GROQ_API_KEY','ELEVENLABS_API_KEY','ELEVENLABS_EN_VOICE_ID','ELEVENLABS_AR_VOICE_ID'])process.env[key]='test-only';
const db=require('../src/db');
const store=require('../src/oralExam/store');
const contracts=require('../src/oralExam/contracts');
const examiner=require('../src/oralExam/examiner');
const {boundedContext,chunksFromText}=require('../src/oralExam/material');
const {attachRealtime}=require('../src/oralExam/realtime');
const app=require('../src/app');
const user={id_student:900};
const material={source:{kind:'text',digest:'test'},title:'Networks',context:boundedContext(chunksFromText('Packets travel through routers. A router selects a path across networks. '.repeat(20)))};
const question={question:'What does a router do?',concept:'Routing',question_type:'initial',difficulty:'foundation',citations:['text-1'],follow_up_reason:''};
const assessment={understanding:80,accuracy:80,completeness:75,communication:90,feedback:'You explained path selection.',strengths:['Path selection'],improvements:['Explain packets']};
let database,server,realtime,finalizeSpeech,nextOverride;
const original={query:db.pool.query,connect:db.pool.connect,transaction:db.transaction,fetch:global.fetch};
const api=(method,path,id=900)=>request(server)[method]('/api/oral-exam'+path).set('Authorization','Bearer '+jwt.sign({id_student:id},process.env.JWT_SECRET));
const create=()=>store.create(user,material,'en',randomUUID());
before(async()=>{
  database=await PGlite.create();
  db.pool.query=async(sql,params=[])=>{
    const result=!params.length&&sql.split(';').length>2?(await database.exec(sql)).at(-1):await database.query(sql,params);
    return {rows:result.rows||[],rowCount:result.affectedRows||result.rows?.length||0};
  };
  // Serialize transactions on the embedded single connection, as in lecture tests.
  let tail=Promise.resolve();
  db.pool.connect=async()=>{const previous=tail;let release;tail=new Promise(r=>{release=r;});await previous;return {query:db.pool.query,release};};
  await require('../scripts/migrate').migrate();
  await database.query("INSERT INTO students(id_student,student_name,pin_hash) VALUES(900,'Oral student','hash'),(901,'Other student','hash')");
  server=app.listen(0,'127.0.0.1');await once(server,'listening');
  realtime=attachRealtime(server,{examiner:{...examiner,next:async(_s,text)=>nextOverride?nextOverride(_s,text):({assessment:text===null?null:assessment,next:text===null?question:{...question,question:'Why is path selection useful?',question_type:'follow_up'}})},voice:{
    speak:async()=>Buffer.from('ID3fake-test-audio'),
    transcriber:({onFinal})=>{finalizeSpeech=onFinal;return {opened:Promise.resolve(),close(){},send(){return true;}};},
  }});
});
after(async()=>{
  realtime.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  db.pool.query=original.query;db.pool.connect=original.connect;global.fetch=original.fetch;
  await database.close();await db.pool.end();
});
test('authenticated creation validates text, isolates reads and rejects foreign material',async()=>{
  assert.equal((await request(server).post('/api/oral-exam/sessions').send({})).status,401);
  assert.equal((await api('post','/sessions').set('Idempotency-Key',randomUUID()).send({source:{kind:'text',title:'Empty',text:''}})).status,400);
  assert.equal((await api('post','/sessions').set('Idempotency-Key',randomUUID()).send({source:{kind:'transcript',id:'another-owner-job'}})).status,404);
  const body={language:'en',source:{kind:'text',title:'Networks',text:'Packets and routers connect computers across a network. '.repeat(5)}};
  const key=randomUUID(),response=await api('post','/sessions').set('Idempotency-Key',key).send(body);
  assert.equal(response.status,201);const id=response.body.session.id;
  assert.equal(response.body.session.context,undefined);assert.equal(response.body.session.owner_key,undefined);
  assert.equal((await api('post','/sessions').set('Idempotency-Key',key).send(body)).body.session.id,id);
  assert.equal((await api('post','/sessions').set('Idempotency-Key',key).send({...body,language:'ar'})).status,409);
  for(const [method,path] of [['get',`/sessions/${id}`],['post',`/sessions/${id}/start`],['post',`/sessions/${id}/end`],['post',`/sessions/${id}/evaluation`]])assert.equal((await api(method,path,901)).status,404);
});
test('duplicate start is idempotent; one active exam; reconnect never resets expiry',async()=>{
  const a=await create(),b=await create();
  const started=await store.start(user,a.id),duplicate=await store.start(user,a.id);
  assert.equal(+new Date(started.expires_at)-new Date(started.started_at),600000);
  assert.equal(+new Date(started.started_at),+new Date(duplicate.started_at));
  await assert.rejects(()=>store.start(user,b.id),{statusCode:409});
  const first=await store.claim(user,a.id);
  await assert.rejects(()=>store.claim(user,a.id),{statusCode:409});
  await store.release(a.id,first.token);
  const second=await store.claim(user,a.id);
  assert.equal(+new Date(second.row.expires_at),+new Date(started.expires_at));
  assert.equal(await store.renew(a.id,first.token),undefined);
  await store.finish(user,a.id);
  await assert.rejects(()=>store.start(user,a.id),{statusCode:409});
  await assert.rejects(()=>store.claim(user,a.id),{statusCode:409});
});
test('turn persistence is fenced, ordered and duplicate answers cannot advance twice',async()=>{
  const a=await create();await store.start(user,a.id);const lease=await store.claim(user,a.id);
  await store.commit(a.id,lease.token,0,null,{assessment:null,next:question});
  await assert.rejects(()=>store.commit(a.id,lease.token,0,null,{assessment:null,next:question}),{statusCode:409});
  await store.commit(a.id,lease.token,1,'It chooses paths.',{assessment,next:{...question,question:'How do packets use paths?',question_type:'follow_up'}});
  await assert.rejects(()=>store.commit(a.id,lease.token,1,'Duplicate',{assessment,next:null}),{statusCode:409});
  const saved=await store.get(user,a.id);assert.equal(saved.turns.length,2);assert.equal(saved.turns[0].transcript,'It chooses paths.');
  await store.release(a.id,lease.token);
  await assert.rejects(()=>store.commit(a.id,lease.token,2,'Old socket',{assessment,next:null}),{statusCode:409});
  await store.finish(user,a.id);
});
test('expired sessions reject turns, start and reconnect independently of browser timers',async()=>{
  const a=await create();await store.start(user,a.id);const lease=await store.claim(user,a.id);
  await database.query("UPDATE edufusion_oral_exam_sessions SET started_at=NOW()-INTERVAL '11 minutes',expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[a.id]);
  await assert.rejects(()=>store.commit(a.id,lease.token,0,null,{assessment:null,next:question}),{statusCode:409});
  const expired=await store.get(user,a.id);assert.equal(expired.status,'timed_out');assert.equal(+new Date(expired.ended_at),+new Date(expired.expires_at));
  await assert.rejects(()=>store.start(user,a.id),{statusCode:409});
  await assert.rejects(()=>store.claim(user,a.id),{statusCode:409});
  await examiner.evaluate(user,a.id);assert.equal((await store.get(user,a.id)).evaluation.score,null);
});
test('database enforces deadline and ownership constraints',async()=>{
  const a=await create();await store.start(user,a.id);
  await assert.rejects(()=>database.query("UPDATE edufusion_oral_exam_sessions SET expires_at=expires_at+INTERVAL '1 second' WHERE id=$1",[a.id]));
  await assert.rejects(()=>database.query("UPDATE edufusion_oral_exam_sessions SET owner_key='student:901' WHERE id=$1",[a.id]));
  await store.finish(user,a.id);
});
test('an in-time answer survives an interrupted model operation and expiry',async()=>{
  const a=await create();await store.start(user,a.id);const lease=await store.claim(user,a.id);
  await store.commit(a.id,lease.token,0,null,{assessment:null,next:question});
  await store.recordAnswer(a.id,lease.token,1,'A router forwards packets along selected paths.');
  await store.recordAnswer(a.id,lease.token,1,'A router forwards packets along selected paths.');
  await assert.rejects(()=>store.recordAnswer(a.id,lease.token,1,'Replace my answer'),{statusCode:409});
  await database.query("UPDATE edufusion_oral_exam_sessions SET started_at=NOW()-INTERVAL '11 minutes',expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[a.id]);
  const saved=await store.get(user,a.id);assert.equal(saved.status,'timed_out');assert.equal(saved.turns[0].assessment,null);assert.match(saved.turns[0].transcript,/forwards packets/);
});
test('material sampling includes transcript tail, evaluation schema refuses fabricated shapes',()=>{
  const text='Introduction '.repeat(4000)+'FINAL CONCEPT AT END';const context=boundedContext(chunksFromText(text));
  assert.ok(context.chunks.length<=24);assert.match(context.chunks.at(-1).text,/FINAL CONCEPT/);
  assert.throws(()=>contracts.evaluation.parse({score:120}));
  assert.throws(()=>contracts.assessment.parse({...assessment,accuracy:101}));
  assert.throws(()=>contracts.assessment.parse({...assessment,reasoning:'hidden'}));
  assert.equal(contracts.weightedScore(assessment),80);
});
test('model output is validated, grounded and failed final evaluation is recoverable',async()=>{
  const a=await create();await store.start(user,a.id);const lease=await store.claim(user,a.id);
  const mock=value=>{global.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}));};
  mock({assessment:null,next:{...question,citations:['foreign-source']}});
  await assert.rejects(async()=>examiner.next({...await store.get(user,a.id),turns:[]},null),{code:'ungrounded_citation'});
  await store.commit(a.id,lease.token,0,null,{assessment:null,next:question});
  await store.commit(a.id,lease.token,1,'A router selects packet routes.',{assessment,next:null});
  await store.finish(user,a.id);mock({understanding:999});await examiner.evaluate(user,a.id);
  assert.equal((await store.get(user,a.id)).evaluation_status,'failed');
  const report={understanding:80,accuracy:80,completeness:75,communication:90,strengths:['Path selection'],areasForImprovement:['Add detail'],topicsCovered:['Fabricated topic'],summary:'You explained the core idea.'};
  mock(report);await examiner.evaluate(user,a.id);
  const saved=await store.get(user,a.id);assert.equal(saved.evaluation_status,'ready');assert.equal(saved.evaluation.score,80);assert.deepEqual(saved.evaluation.topicsCovered,['Routing']);
  global.fetch=original.fetch;
});
test('final evaluation retries one invalid output and persists only the valid report',async()=>{
  const a=await create();await store.start(user,a.id);const lease=await store.claim(user,a.id);
  await store.commit(a.id,lease.token,0,null,{assessment:null,next:question});
  await store.commit(a.id,lease.token,1,'A router selects paths for packets.',{assessment,next:null});
  await store.finish(user,a.id);
  const report={understanding:80,accuracy:80,completeness:75,communication:90,strengths:['Path selection'],areasForImprovement:['Add detail'],topicsCovered:['Routing'],summary:'You explained the core idea.'};
  let calls=0;
  global.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(++calls===1?{...report,accuracy:80.5}:report)}}]}));
  try {
    await examiner.evaluate(user,a.id);
    const saved=await store.get(user,a.id);
    assert.equal(calls,2);assert.equal(saved.evaluation_status,'ready');assert.equal(saved.evaluation.score,80);
    assert.equal(saved.turns.length,1);assert.equal(saved.turns[0].transcript,'A router selects paths for packets.');
  } finally {global.fetch=original.fetch;}
});
async function socket(sessionId,student=900,origin='http://localhost:3000') {
  const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/api/oral-exam/realtime`,{origin});
  const events=[];ws.on('message',raw=>events.push(JSON.parse(raw.toString())));
  await once(ws,'open');ws.send(JSON.stringify({type:'hello',sessionId,token:jwt.sign({id_student:student},process.env.JWT_SECRET)}));
  const until=async predicate=>{const end=Date.now()+4000;while(Date.now()<end){const found=events.find(predicate);if(found)return found;await new Promise(r=>setTimeout(r,10));}throw new Error('Expected socket event did not arrive');};
  return {ws,events,until};
}
test('real WebSocket authenticates, resumes persisted question, and automatically cuts off on deadline',async()=>{
  // Reset daily fixture quota; this is not an API that students can invoke.
  await database.query("UPDATE edufusion_oral_exam_sessions SET created_at=NOW()-INTERVAL '2 days'");
  const a=await create();await store.start(user,a.id);
  const connection=await socket(a.id);await connection.until(e=>e.type==='audio');
  connection.ws.send(JSON.stringify({type:'played',sequence:1}));await connection.until(e=>e.type==='state'&&e.state==='listening');
  finalizeSpeech('The router selects a path.');await connection.until(e=>e.type==='question'&&e.sequence===2);
  connection.ws.terminate();await once(connection.ws,'close');
  // Close releases its lease asynchronously.
  await new Promise(r=>setTimeout(r,50));
  const before=await store.get(user,a.id);const resumed=await socket(a.id);await resumed.until(e=>e.type==='question'&&e.sequence===2);
  assert.equal(+new Date((await store.get(user,a.id)).expires_at),+new Date(before.expires_at));
  resumed.ws.terminate();await once(resumed.ws,'close');await new Promise(r=>setTimeout(r,50));
  await database.query("UPDATE edufusion_oral_exam_sessions SET started_at=clock_timestamp()-INTERVAL '599.5 seconds',expires_at=clock_timestamp()+INTERVAL '0.5 seconds' WHERE id=$1",[a.id]).catch(async()=>{
    // Single timestamp keeps the exact-duration check deterministic.
    await database.query("WITH t AS (SELECT NOW() AS n) UPDATE edufusion_oral_exam_sessions SET started_at=t.n-INTERVAL '599.5 seconds',expires_at=t.n+INTERVAL '0.5 seconds' FROM t WHERE id=$1",[a.id]);
  });
  const expiring=await socket(a.id);await expiring.until(e=>e.type==='ended');assert.equal((await store.get(user,a.id)).status,'timed_out');
});
test('model failure preserves the accepted answer and reconnect resumes one incomplete turn',async()=>{
  await database.query("UPDATE edufusion_oral_exam_sessions SET created_at=NOW()-INTERVAL '2 days'");
  const a=await create();const started=await store.start(user,a.id);
  const first=await socket(a.id);await first.until(e=>e.type==='audio');
  first.ws.send(JSON.stringify({type:'played',sequence:1}));await first.until(e=>e.type==='state'&&e.state==='listening');
  nextOverride=async(_session,text)=>{
    if(text===null)return {assessment:null,next:question};
    throw new Error('Synthetic transient model failure');
  };
  try {
    finalizeSpeech('A router selects packet paths.');
    await first.until(e=>e.type==='error');
    const stranded=await store.get(user,a.id);
    assert.equal(stranded.turns.length,1);assert.equal(stranded.turns[0].transcript,'A router selects packet paths.');
    assert.equal(stranded.turns[0].assessment,null);
    assert.equal(+new Date(stranded.started_at),+new Date(started.started_at));
    assert.equal(+new Date(stranded.expires_at),+new Date(started.expires_at));
    first.ws.terminate();await once(first.ws,'close');await new Promise(r=>setTimeout(r,50));
    nextOverride=async(_session,text)=>({assessment:text===null?null:assessment,next:text===null?question:{...question,question:'How are paths selected?',question_type:'follow_up'}});
    const recovered=await socket(a.id);await recovered.until(e=>e.type==='question'&&e.sequence===2);
    const saved=await store.get(user,a.id);
    assert.equal(saved.turns.length,2);assert.equal(saved.turns[0].transcript,'A router selects packet paths.');
    assert.equal(+new Date(saved.started_at),+new Date(started.started_at));
    assert.equal(+new Date(saved.expires_at),+new Date(started.expires_at));
    recovered.ws.terminate();await once(recovered.ws,'close');await store.finish(user,a.id);
  } finally {nextOverride=undefined;}
});
test('WebSocket rejects foreign owners and untrusted origins before voice starts',async()=>{
  const a=await create();await store.start(user,a.id);
  const foreign=await socket(a.id,901);await foreign.until(e=>e.type==='error');assert.equal(foreign.events.some(e=>e.type==='question'),false);
  const denied=new WebSocket(`ws://127.0.0.1:${server.address().port}/api/oral-exam/realtime`,{origin:'https://evil.example'});
  denied.on('error',()=>{});const [response]=await once(denied,'unexpected-response').then(([,response])=>[response]);assert.equal(response.statusCode,403);denied.terminate();
  await store.finish(user,a.id);
});
test('existing learning chunks are reused only for a current member',async()=>{
  const learning=require('../src/lectureStudy/database');
  const oldQuery=learning.query,oldTransaction=learning.transaction;
  learning.query=db.pool.query;learning.transaction=db.transaction;
  process.env.LECTURE_STUDY_ENABLED='true';process.env.LEARNING_DATABASE_URL='postgresql://test@localhost/learning';
  try{
    await require('../scripts/migrateLearning').migrate();
    const lectureId=randomUUID();
    await database.query("INSERT INTO study_lectures(id,source_key,youtube_url,language,title,status) VALUES($1,$2,'https://youtu.be/abcdefghijk','en','Owned lecture','ready')",[lectureId,randomUUID()]);
    await database.query("INSERT INTO study_members(owner_key,lecture_id) VALUES('student:900',$1)",[lectureId]);
    await database.query("INSERT INTO study_chunks(lecture_id,version,id,text,section,ordinal) VALUES($1,1,'chunk-1','Routers forward packets between networks.','Routing',0)",[lectureId]);
    const body={source:{kind:'lecture',id:lectureId},language:'en'};
    assert.equal((await api('post','/sessions',901).set('Idempotency-Key',randomUUID()).send(body)).status,404);
    const response=await api('post','/sessions').set('Idempotency-Key',randomUUID()).send(body);assert.equal(response.status,201);
    const saved=await store.get(user,response.body.session.id);assert.equal(saved.context.chunks[0].id,'chunk-1');
  }finally{learning.query=oldQuery;learning.transaction=oldTransaction;process.env.LECTURE_STUDY_ENABLED='false';}
});
test('database write failures return a safe error and do not claim a session was created',async()=>{
  const execute=db.pool.query;
  db.pool.query=async(sql,params)=>{if(sql.startsWith('INSERT INTO edufusion_oral_exam_sessions'))throw Object.assign(new Error('private connection detail'),{code:'08006'});return execute(sql,params);};
  try{
    const response=await api('post','/sessions').set('Idempotency-Key',randomUUID()).send({source:{kind:'text',title:'DB failure fixture',text:'Packets connect computers through routes. '.repeat(5)}});
    assert.equal(response.status,503);assert.doesNotMatch(JSON.stringify(response.body),/private|08006|stack/);assert.equal(response.body.session,undefined);
  }finally{db.pool.query=execute;}
});
