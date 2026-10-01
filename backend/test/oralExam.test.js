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
let database,server,realtime,finalizeSpeech,nextOverride,replyOverride;
const spoken=[];
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
  realtime=attachRealtime(server,{closingTimeoutMs:50,examiner:{...examiner,evaluate:async()=>{},next:async(_s,text,signal,options)=>nextOverride?nextOverride(_s,text,signal,options):({assessment:text===null?null:assessment,next:text===null?question:{...question,question:'Why is path selection useful?',question_type:'follow_up'}}),
    reply:async(_s,text,intent)=>replyOverride?replyOverride(_s,text,intent):({intent,reply:intent==='clarify'?'In other words, what job does this device do for packets?':'No problem. Share anything you remember about this device.',assessment:null,next:null})},voice:{
    speak:async text=>{spoken.push(text);return Buffer.from('ID3fake-test-audio');},
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
  await examiner.evaluate(user,a.id);assert.equal((await store.get(user,a.id)).core_evaluation.score,null);
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
  mock({intent:'answer',reply:null,assessment:null,core_concepts:[{name:'Routing',citations:['text-1']}],next:{...question,citations:['foreign-source']}});
  await assert.rejects(async()=>examiner.next({...await store.get(user,a.id),turns:[]},null),{code:'ungrounded_citation'});
  await store.commit(a.id,lease.token,0,null,{assessment:null,next:question});
  await store.commit(a.id,lease.token,1,'A router selects packet routes.',{assessment,next:null});
  await store.finish(user,a.id);mock({understanding:999});await examiner.evaluate(user,a.id);
  assert.equal((await store.get(user,a.id)).evaluation_status,'failed');
  const report={strengths:['Path selection'],areasForImprovement:['Add detail'],summary:'You explained the core idea.'};
  mock(report);await examiner.evaluate(user,a.id);
  const saved=await store.get(user,a.id);assert.equal(saved.evaluation_status,'ready');assert.equal(saved.core_evaluation.score,80);assert.deepEqual(saved.core_evaluation.topicsCovered,['Routing']);
  global.fetch=original.fetch;
});
test('final evaluation retries one invalid output and persists only the valid report',async()=>{
  const a=await create();await store.start(user,a.id);const lease=await store.claim(user,a.id);
  await store.commit(a.id,lease.token,0,null,{assessment:null,next:question});
  await store.commit(a.id,lease.token,1,'A router selects paths for packets.',{assessment,next:null});
  await store.finish(user,a.id);
  const report={strengths:['Path selection'],areasForImprovement:['Add detail'],summary:'You explained the core idea.'};
  let calls=0;
  global.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(++calls===1?{...report,summary:42}:report)}}]}));
  try {
    await examiner.evaluate(user,a.id);
    const saved=await store.get(user,a.id);
    assert.equal(calls,2);assert.equal(saved.evaluation_status,'ready');assert.equal(saved.core_evaluation.score,80);
    assert.equal(saved.turns.length,1);assert.equal(saved.turns[0].transcript,'A router selects paths for packets.');
  } finally {global.fetch=original.fetch;}
});
async function socket(sessionId,student=900,origin='http://localhost:3000') {
  const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/api/oral-exam/realtime`,{origin});
  const events=[];ws.on('message',raw=>events.push(JSON.parse(raw.toString())));
  const closed=once(ws,'close');
  await once(ws,'open');ws.send(JSON.stringify({type:'hello',sessionId,token:jwt.sign({id_student:student},process.env.JWT_SECRET)}));
  const until=async(predicate,from=0)=>{const end=Date.now()+4000;while(Date.now()<end){const found=events.slice(from).find(predicate);if(found)return found;await new Promise(r=>setTimeout(r,10));}throw new Error('Expected socket event did not arrive');};
  return {ws,events,until,closed};
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
  assert.ok(expiring.events.some(e=>e.type==='closing'));
  assert.ok(expiring.events.find(e=>e.type==='ended').session.evaluation);
});
test('model failure preserves the accepted answer and reconnect resumes one incomplete turn',{timeout:30000},async()=>{
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
    // The server now closes automatically. Observe closure from before the
    // failure, even when the handshake finishes before the database reads.
    assert.equal((await first.closed)[0],4500);await new Promise(r=>setTimeout(r,50));
    nextOverride=async(_session,text)=>({assessment:text===null?null:assessment,next:text===null?question:{...question,question:'How are paths selected?',question_type:'follow_up'}});
    const recovered=await socket(a.id);await recovered.until(e=>e.type==='question'&&e.sequence===2);
    const saved=await store.get(user,a.id);
    assert.equal(saved.turns.length,2);assert.equal(saved.turns[0].transcript,'A router selects packet paths.');
    assert.equal(+new Date(saved.started_at),+new Date(started.started_at));
    assert.equal(+new Date(saved.expires_at),+new Date(started.expires_at));
    recovered.ws.terminate();await once(recovered.ws,'close');await store.finish(user,a.id);
  } finally {nextOverride=undefined;}
});
// Drives one spoken utterance through the socket and returns the examiner's
// next `question` event (same sequence for a conversational reply, a new
// sequence for a real answer), after the browser reports playback.
async function say(connection,text) {
  const from=connection.events.length;
  finalizeSpeech(text);
  const event=await connection.until(e=>e.type==='question',from);
  await connection.until(e=>e.type==='audio',from);
  connection.ws.send(JSON.stringify({type:'played',sequence:event.sequence}));
  await connection.until(e=>e.type==='state'&&e.state==='listening',from);
  return event;
}
test('repeat, clarify and "I don\'t know" keep the same question unscored, then the exam moves on',async()=>{
  await database.query("UPDATE edufusion_oral_exam_sessions SET created_at=NOW()-INTERVAL '2 days'");
  const a=await create();const started=await store.start(user,a.id);
  const modelCalls=[];
  nextOverride=async(_session,text)=>{modelCalls.push(text);return {intent:'answer',reply:null,assessment:text===null?null:assessment,next:text===null?question:{...question,question:`Follow-up ${modelCalls.length}: how are paths selected?`,question_type:'follow_up'}};};
  try {
    const c=await socket(a.id);await c.until(e=>e.type==='audio');
    c.ws.send(JSON.stringify({type:'played',sequence:1}));await c.until(e=>e.type==='state'&&e.state==='listening');
    const repeated=await say(c,'Can you repeat the question?');
    assert.equal(repeated.sequence,1);assert.equal(repeated.kind,'repeat');assert.equal(repeated.question,question.question);assert.match(repeated.remark,/Here is the question again/);
    const clarified=await say(c,"I didn't understand the question.");
    assert.equal(clarified.sequence,1);assert.equal(clarified.kind,'clarification');assert.equal(clarified.remark,'In other words, what job does this device do for packets?');
    const nudged=await say(c,"I don't know.");
    assert.equal(nudged.sequence,1);assert.equal(nudged.kind,'nudge');assert.match(nudged.remark,/Share anything you remember/);
    assert.deepEqual(modelCalls,[null]);
    let saved=await store.get(user,a.id);
    assert.equal(saved.turns.length,1);assert.equal(saved.turns[0].transcript,null);assert.equal(saved.turns[0].assessment,null);
    assert.deepEqual(saved.turns[0].exchanges.map(e=>e.kind),['repeat','clarification','nudge']);
    assert.deepEqual(saved.turns[0].exchanges.map(e=>e.transcript),['Can you repeat the question?',"I didn't understand the question.","I don't know."]);
    // The nudge was used, so a second "I don't know" is the answer of record.
    const advanced=await say(c,"I don't know.");
    assert.equal(advanced.sequence,2);assert.equal(advanced.kind,'question');
    assert.deepEqual(modelCalls,[null,"I don't know."]);
    // A partial answer is assessed and the follow-up targets the same concept.
    const followUp=await say(c,'It sends packets somewhere.');
    assert.equal(followUp.sequence,3);assert.match(followUp.question,/how are paths selected/);
    // Unusable speech asks for the answer again without a model call.
    const retry=await say(c,'um');
    assert.equal(retry.sequence,3);assert.equal(retry.kind,'retry');assert.match(retry.remark,/say your answer again/);
    assert.equal(modelCalls.length,3);
    saved=await store.get(user,a.id);
    assert.equal(saved.turns.length,3);assert.equal(saved.turns[0].transcript,"I don't know.");assert.ok(saved.turns[0].assessment);
    assert.equal(saved.turns[1].transcript,'It sends packets somewhere.');assert.equal(saved.turns[1].question_type,'follow_up');
    assert.deepEqual(saved.turns[2].exchanges.map(e=>e.kind),['retry']);
    assert.equal(+new Date(saved.expires_at),+new Date(started.expires_at));assert.equal(+new Date(saved.started_at),+new Date(started.started_at));
    const view=store.publicView(saved);
    assert.equal(view.turns[0].exchanges.length,3);assert.equal(view.turns[0].exchanges[1].reply,'In other words, what job does this device do for packets?');
    c.ws.terminate();await once(c.ws,'close');await store.finish(user,a.id);
  } finally {nextOverride=undefined;}
});
test('the model may classify a longer utterance as a request, which clears the provisional transcript',async()=>{
  await database.query("UPDATE edufusion_oral_exam_sessions SET created_at=NOW()-INTERVAL '2 days'");
  const a=await create();await store.start(user,a.id);
  const long='Honestly I am struggling to work out exactly what it is that you are asking me to talk about with this question here';
  nextOverride=async(_session,text)=>text===null?{intent:'answer',reply:null,assessment:null,next:question}:{intent:'clarify',reply:'Put simply, what is the job of this device?',assessment:null,next:null};
  try {
    const c=await socket(a.id);await c.until(e=>e.type==='audio');
    c.ws.send(JSON.stringify({type:'played',sequence:1}));await c.until(e=>e.type==='state'&&e.state==='listening');
    const clarified=await say(c,long);
    assert.equal(clarified.sequence,1);assert.equal(clarified.kind,'clarification');assert.equal(clarified.remark,'Put simply, what is the job of this device?');
    const saved=await store.get(user,a.id);
    assert.equal(saved.turns.length,1);assert.equal(saved.turns[0].transcript,null);assert.equal(saved.turns[0].answered_at,null);
    assert.deepEqual(saved.turns[0].exchanges.map(e=>[e.kind,e.transcript]),[['clarification',long]]);
    c.ws.terminate();await once(c.ws,'close');await store.finish(user,a.id);
  } finally {nextOverride=undefined;}
});
test('Arabic control phrases are handled in Arabic and bounded the same way',async()=>{
  await database.query("UPDATE edufusion_oral_exam_sessions SET created_at=NOW()-INTERVAL '2 days'");
  const arabicQuestion={...question,question:'ما هي وظيفة الراوتر؟'};
  const a=await store.create(user,material,'ar',randomUUID());const started=await store.start(user,a.id);
  const modelCalls=[];
  nextOverride=async(_session,text)=>{modelCalls.push(text);return {intent:'answer',reply:null,assessment:text===null?null:assessment,next:text===null?arabicQuestion:{...arabicQuestion,question:'كيف يختار الراوتر المسار؟',question_type:'follow_up'}};};
  replyOverride=async(_session,_text,intent)=>({intent,reply:intent==='clarify'?'بكلمات أبسط، ما الذي يقوم به هذا الجهاز؟':'لا بأس، أخبرني بأي شيء تتذكره عن هذا الجهاز.',assessment:null,next:null});
  try {
    const c=await socket(a.id);await c.until(e=>e.type==='audio');
    c.ws.send(JSON.stringify({type:'played',sequence:1}));await c.until(e=>e.type==='state'&&e.state==='listening');
    const repeated=await say(c,'عيد السؤال');
    assert.equal(repeated.sequence,1);assert.equal(repeated.kind,'repeat');assert.match(repeated.remark,/إليك السؤال مرة أخرى/);
    const clarified=await say(c,'مش فاهم');
    assert.equal(clarified.kind,'clarification');assert.equal(clarified.remark,'بكلمات أبسط، ما الذي يقوم به هذا الجهاز؟');
    // Only one clarification per question: the next request becomes the single nudge.
    const nudged=await say(c,'وضح السؤال');
    assert.equal(nudged.sequence,1);assert.equal(nudged.kind,'nudge');assert.match(nudged.remark,/أخبرني بأي شيء تتذكره/);
    const advanced=await say(c,'ما بعرف');
    assert.equal(advanced.sequence,2);assert.equal(advanced.kind,'question');assert.equal(advanced.question,'كيف يختار الراوتر المسار؟');
    assert.deepEqual(modelCalls,[null,'ما بعرف']);
    const saved=await store.get(user,a.id);
    assert.equal(saved.turns[0].transcript,'ما بعرف');assert.deepEqual(saved.turns[0].exchanges.map(e=>e.kind),['repeat','clarification','nudge']);
    assert.equal(+new Date(saved.expires_at),+new Date(started.expires_at));
    c.ws.terminate();await once(c.ws,'close');await store.finish(user,a.id);
  } finally {nextOverride=undefined;replyOverride=undefined;}
});
test('a second "I don\'t know" after the nudge never ends the exam, even when the model still returns dont_know',async()=>{
  await database.query("UPDATE edufusion_oral_exam_sessions SET created_at=NOW()-INTERVAL '2 days'");
  const a=await create();const started=await store.start(user,a.id);
  const calls=[];
  nextOverride=async(_session,text,_signal,options={})=>{
    calls.push({text,forceAnswer:Boolean(options.forceAnswer)});
    if(text===null)return {intent:'answer',reply:null,assessment:null,next:question};
    // The model insists on dont_know until it is told the allowance is used up.
    if(!options.forceAnswer)return {intent:'dont_know',reply:'Take your time.',assessment:null,next:null};
    return {intent:'answer',reply:null,assessment:{...assessment,accuracy:5,completeness:0},next:{...question,question:'What is a routing table?',concept:'Routing tables '+_session.turns.length,question_type:'next_topic'}};
  };
  try {
    const c=await socket(a.id);await c.until(e=>e.type==='audio');
    c.ws.send(JSON.stringify({type:'played',sequence:1}));await c.until(e=>e.type==='state'&&e.state==='listening');
    const nudged=await say(c,"I don't know.");
    assert.equal(nudged.kind,'nudge');assert.equal(nudged.sequence,1);
    const advanced=await say(c,"I don't know.");
    assert.equal(advanced.sequence,2);assert.equal(advanced.kind,'question');assert.equal(advanced.question,'What is a routing table?');
    assert.deepEqual(calls,[{text:null,forceAnswer:false},{text:"I don't know.",forceAnswer:true}]);
    const saved=await store.get(user,a.id);
    assert.equal(saved.status,'active');assert.equal(saved.turns.length,2);
    assert.equal(saved.turns[0].transcript,"I don't know.");assert.equal(saved.turns[0].assessment.completeness,0);
    assert.equal(+new Date(saved.expires_at),+new Date(started.expires_at));
    // A long utterance the model classifies as dont_know gets the one nudge on
    // the new question; the next one is past its allowance, so it is re-asked
    // with the flag and assessed, never committed as a control decision.
    const longer='Honestly I really do not know anything about this one at all I am completely lost here';
    const nudgedAgain=await say(c,longer);
    assert.equal(nudgedAgain.sequence,2);assert.equal(nudgedAgain.kind,'nudge');assert.equal(nudgedAgain.remark,'Take your time.');
    const again=await say(c,longer);
    assert.equal(again.sequence,3);
    assert.deepEqual(calls.slice(2),[{text:longer,forceAnswer:false},{text:longer,forceAnswer:false},{text:longer,forceAnswer:true}]);
    assert.equal((await store.get(user,a.id)).status,'active');
    c.ws.terminate();await once(c.ws,'close');await store.finish(user,a.id);
  } finally {nextOverride=undefined;}
});
test('the store refuses to save an unassessed answer or a control decision as an answer',async()=>{
  const a=await create();await store.start(user,a.id);const lease=await store.claim(user,a.id);
  await store.commit(a.id,lease.token,0,null,{intent:'answer',reply:null,assessment:null,next:question});
  await assert.rejects(()=>store.commit(a.id,lease.token,1,"I don't know",{intent:'dont_know',reply:'Take your time.',assessment:null,next:null}),{statusCode:409});
  await assert.rejects(()=>store.commit(a.id,lease.token,1,'A router forwards packets.',{intent:'answer',reply:null,assessment:null,next:null}),{statusCode:409});
  const saved=await store.get(user,a.id);
  assert.equal(saved.status,'active');assert.equal(saved.turns.length,1);assert.equal(saved.turns[0].assessment,null);
  await store.finish(user,a.id);
});
test('ending an exam responds before feedback is generated and the report still arrives',async()=>{
  await database.query("UPDATE edufusion_oral_exam_sessions SET created_at=NOW()-INTERVAL '2 days'");
  const a=await create();await store.start(user,a.id);const lease=await store.claim(user,a.id);
  await store.commit(a.id,lease.token,0,null,{assessment:null,next:question});
  await store.commit(a.id,lease.token,1,'A router selects packet routes.',{assessment,next:null});
  await store.release(a.id,lease.token);
  const report={strengths:['Path selection'],areasForImprovement:['Add detail'],summary:'You explained the core idea.'};
  let release;const gate=new Promise(resolve=>{release=resolve;});
  global.fetch=async()=>{await gate;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(report)}}]}));};
  try {
    const startedAt=Date.now();
    const ended=await api('post',`/sessions/${a.id}/end`);
    assert.ok(Date.now()-startedAt<1500);
    assert.equal(ended.status,200);assert.equal(ended.body.session.status,'completed');
    assert.deepEqual(ended.body.evaluation,{status:'pending'});assert.equal(ended.body.session.evaluation_status,'pending');
    release();
    for(let i=0;i<100&&(await store.get(user,a.id)).evaluation_status!=='ready';i++)await new Promise(r=>setTimeout(r,20));
    const saved=await store.get(user,a.id);
    assert.equal(saved.evaluation_status,'ready');assert.equal(saved.core_evaluation.score,80);
    assert.deepEqual((await api('post',`/sessions/${a.id}/end`)).body.evaluation,{status:'ready',cached:true});
  } finally {global.fetch=original.fetch;}
});
test('feedback retry reports each outcome, stays idempotent and never touches saved answers',async()=>{
  await database.query("UPDATE edufusion_oral_exam_sessions SET created_at=NOW()-INTERVAL '2 days'");
  const a=await create();await store.start(user,a.id);const lease=await store.claim(user,a.id);
  await store.commit(a.id,lease.token,0,null,{assessment:null,next:question});
  await store.commit(a.id,lease.token,1,'A router selects packet routes.',{assessment,next:null});
  await store.finish(user,a.id);
  const turnsBefore=(await store.get(user,a.id)).turns;
  const auth=`/sessions/${a.id}/evaluation`;
  let fetches=0;
  global.fetch=async()=>{fetches++;return new Response('{}',{status:503});};
  try {
    let response=await api('post',auth);
    assert.equal(response.status,200);assert.deepEqual(response.body.evaluation,{status:'failed',error:'model_unavailable'});
    assert.equal(response.body.session.evaluation_status,'failed');assert.equal(response.body.session.evaluation_error,'model_unavailable');assert.equal(response.body.session.evaluation_attempts,1);
    assert.equal(response.body.session.evaluation.score,80);assert.equal(response.body.session.evaluation.commentary,null);
    global.fetch=async()=>{fetches++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({understanding:999})}}]}));};
    response=await api('post',auth);
    assert.deepEqual(response.body.evaluation,{status:'failed',error:'invalid_model_output'});assert.equal(response.body.session.evaluation_attempts,2);
    const report={strengths:['Path selection'],areasForImprovement:['Add detail'],summary:'You explained the core idea.'};
    fetches=0;
    global.fetch=async()=>{fetches++;await new Promise(r=>setTimeout(r,30));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(report)}}]}));};
    // Two concurrent retries share one model call.
    const [first,second]=await Promise.all([api('post',auth),api('post',auth)]);
    assert.equal(fetches,1);
    for(const result of [first,second]){assert.equal(result.status,200);assert.equal(result.body.session.evaluation_status,'ready');assert.equal(result.body.session.evaluation.score,80);}
    assert.ok([first,second].some(r=>r.body.evaluation.status==='ready'));
    const again=await api('post',auth);
    assert.deepEqual(again.body.evaluation,{status:'ready',cached:true});assert.equal(fetches,1);
    const saved=await store.get(user,a.id);
    assert.equal(saved.evaluation_error,null);assert.equal(saved.evaluation_attempts,3);assert.deepEqual(saved.turns,turnsBefore);
  } finally {global.fetch=original.fetch;}
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

test('transition is persisted and spoken before the next question; closing rejects further answers',async()=>{
  await database.query("UPDATE edufusion_oral_exam_sessions SET created_at=NOW()-INTERVAL '2 days'");
  const a=await create();const started=await store.start(user,a.id);
  nextOverride=async(s,text)=>({intent:'answer',assessment:text===null?null:assessment,transition:text===null?null:'You identified the main idea clearly.',next:s.turns.length>=2?null:text===null?question:{...question,question:'How does path selection work?',question_type:'follow_up'}});
  const c=await socket(a.id);
  try{
    await c.until(e=>e.type==='audio');c.ws.send(JSON.stringify({type:'played',sequence:1}));await c.until(e=>e.type==='state'&&e.state==='listening');
    const next=await say(c,'It selects a path.');assert.equal(next.transition,'You identified the main idea clearly.');
    assert.ok(spoken.some(text=>text==='You identified the main idea clearly. How does path selection work?'));
    const persisted=await store.get(user,a.id);assert.equal(persisted.turns[1].category,'follow_up');assert.equal(persisted.turns[1].parent_sequence,1);
    assert.equal(persisted.turns[1].transition,next.transition);
    c.ws.send(JSON.stringify({type:'played',sequence:2}));await c.until(e=>e.type==='state'&&e.state==='listening',c.events.indexOf(next));
    finalizeSpeech('It uses the routing table.');
    await c.until(e=>e.type==='closing');const ended=await c.until(e=>e.type==='ended');
    assert.ok(c.events.findIndex(e=>e.type==='closing')<c.events.findIndex(e=>e.type==='ended'));
    assert.equal(ended.session.status,'completed');assert.equal(ended.session.evaluation.completed_core_concepts,1);assert.equal(ended.session.evaluation.follow_up_questions,1);
    assert.equal(+new Date(ended.session.expires_at),+new Date(started.expires_at));
    await assert.rejects(()=>store.recordAnswer(a.id,persisted.lease_token,2,'Too late'),{statusCode:409});
  }finally{nextOverride=undefined;c.ws.terminate();await c.closed;await store.finish(user,a.id);}
});

test('core plan, five cores, follow-ups and bonus remain reconstructible after reload',async()=>{
  await database.query("UPDATE edufusion_oral_exam_sessions SET created_at=NOW()-INTERVAL '2 days'");
  const a=await create();await store.start(user,a.id);const lease=await store.claim(user,a.id);
  const plan=Array.from({length:5},(_,i)=>({name:'Concept '+i,citations:['text-1']}));
  const q=(name,type='next_topic')=>({...question,concept:name,question_type:type,question:'Explain '+name+'?'});
  const score=n=>({...assessment,understanding:n,accuracy:n,completeness:n,communication:n});
  await store.commit(a.id,lease.token,0,null,{assessment:null,core_concepts:plan,next:q('Concept 0','initial')});
  await store.commit(a.id,lease.token,1,'Initial',{assessment:score(60),next:q('Concept 0','follow_up')});
  await store.commit(a.id,lease.token,2,'Follow-up',{assessment:score(90),next:q('Concept 1')});
  for(let i=1;i<=3;i++)await store.commit(a.id,lease.token,i+2,'Answer '+i,{assessment:score(80),next:q('Concept '+(i+1))});
  await store.commit(a.id,lease.token,6,'Answer 4',{assessment:score(80),next:q('Application','bonus')});
  await store.commit(a.id,lease.token,7,'Bonus answer',{assessment:score(92),next:null});
  const saved=await store.ensureCore(user,a.id),r=store.publicView(saved).evaluation;
  assert.equal(saved.context.core_plan.length,5);assert.equal(r.completed_core_concepts,5);assert.equal(r.follow_up_questions,1);assert.equal(r.bonus_questions,1);
  assert.equal(r.core_score,78);assert.equal(r.bonus_score,4);assert.equal(r.score,82);
  assert.deepEqual((await store.ensureCore(user,a.id)).core_evaluation,saved.core_evaluation);
});

test('a persisted core report is available while commentary is pending and stale feedback workers are fenced',async()=>{
  await database.query("UPDATE edufusion_oral_exam_sessions SET created_at=NOW()-INTERVAL '2 days'");
  const a=await create();await store.start(user,a.id);const lease=await store.claim(user,a.id);
  await store.commit(a.id,lease.token,0,null,{assessment:null,next:question});
  await store.commit(a.id,lease.token,1,'Saved answer',{assessment,next:null});
  const saved=await store.ensureCore(user,a.id),first=await store.claimFeedback(a.id);
  assert.ok(first);assert.equal(await store.claimFeedback(a.id),null);
  assert.equal(store.publicView(saved).evaluation.score,80);
  await database.query("UPDATE edufusion_oral_exam_sessions SET feedback_until=NOW()-INTERVAL '1 second' WHERE id=$1",[a.id]);
  const interrupted=store.publicView(await store.get(user,a.id));
  assert.equal(interrupted.evaluation_status,'failed');assert.equal(interrupted.evaluation_error,'timeout');assert.equal(interrupted.evaluation.score,80);
  const second=await store.claimFeedback(a.id);assert.ok(second);
  await store.completeFeedback(a.id,second,{summary:'Ready',strengths:[],areasForImprovement:[]});
  await store.completeFeedback(a.id,first,null,'timeout');
  const after=await store.get(user,a.id);assert.equal(after.evaluation_status,'ready');assert.deepEqual(after.core_evaluation,saved.core_evaluation);
});

const historicalReport={score:84,understanding:86,accuracy:82,completeness:80,communication:90,strengths:['Original strength'],areasForImprovement:['Original improvement'],topicsCovered:['Routing'],summary:'  Original saved commentary.  '};
async function historicalSession(evaluation,status='ready'){
  await database.query("UPDATE edufusion_oral_exam_sessions SET created_at=NOW()-INTERVAL '2 days'");
  const row=await create();await store.start(user,row.id);const lease=await store.claim(user,row.id);
  await store.commit(row.id,lease.token,0,null,{assessment:null,next:question});
  await store.commit(row.id,lease.token,1,'Original answer',{assessment,next:null});
  await database.query("UPDATE edufusion_oral_exam_sessions SET context=context-'oral_policy'-'core_plan',core_evaluation=NULL,evaluation=$2,evaluation_status=$3 WHERE id=$1",[row.id,evaluation,status]);
  await database.query('UPDATE edufusion_oral_exam_turns SET category=NULL,concept_key=NULL,parent_sequence=NULL WHERE session_id=$1',[row.id]);
  return row.id;
}
test('historical API reads and feedback retries preserve the exact saved report without writing core results',async()=>{
  const id=await historicalSession(historicalReport);
  const before=(await database.query('SELECT * FROM edufusion_oral_exam_sessions WHERE id=$1',[id])).rows[0];
  const beforeTurns=(await database.query('SELECT * FROM edufusion_oral_exam_turns WHERE session_id=$1',[id])).rows;
  const fetch=global.fetch;global.fetch=()=>{throw new Error('A historical report must not request a provider');};
  try{
    for(let i=0;i<3;i++){
      const response=await api('get',`/sessions/${id}`);assert.equal(response.status,200);
      const view=response.body.session;
      assert.deepEqual(view.evaluation,{...historicalReport,version:0,legacy:true});
      assert.equal(view.evaluation_status,'ready');assert.equal(view.turns[0].category,null);
      assert.equal(view.turns[0].concept_key,null);assert.equal(view.evaluation.required_concepts,undefined);
    }
    assert.equal((await store.ensureCore(user,id)).core_evaluation,null);
    const retry=await api('post',`/sessions/${id}/evaluation`);
    assert.equal(retry.status,200);assert.deepEqual(retry.body.evaluation,{status:'ready',cached:true});
    assert.deepEqual(retry.body.session.evaluation,{...historicalReport,version:0,legacy:true});
    assert.equal((await api('post',`/sessions/${id}/end`)).body.evaluation.status,'ready');
  }finally{global.fetch=fetch;}
  assert.deepEqual((await database.query('SELECT * FROM edufusion_oral_exam_sessions WHERE id=$1',[id])).rows[0],before);
  assert.deepEqual((await database.query('SELECT * FROM edufusion_oral_exam_turns WHERE session_id=$1',[id])).rows,beforeTurns);
});

test('historical missing or unusable reports remain unscored, without policy inference or provider writes',async()=>{
  for(const [evaluation,status] of [[null,'pending'],[null,'failed'],[{score:84},'ready']]){
    const id=await historicalSession(evaluation,status);
    const before=(await database.query('SELECT * FROM edufusion_oral_exam_sessions WHERE id=$1',[id])).rows[0];
    const view=(await api('get',`/sessions/${id}`)).body.session;
    assert.equal(view.evaluation.version,0);assert.equal(view.evaluation.legacy,true);
    assert.equal(view.evaluation.score,null);assert.equal(view.evaluation.unscored,true);
    assert.equal(view.evaluation.required_concepts,undefined);assert.equal(view.evaluation_status,'unavailable');
    assert.equal(view.turns[0].transcript,'Original answer');
    const retry=await api('post',`/sessions/${id}/evaluation`);
    assert.equal(retry.status,200);assert.equal(retry.body.evaluation.status,'unavailable');
    assert.equal((await api('post',`/sessions/${id}/end`)).body.evaluation.status,'unavailable');
    assert.deepEqual((await database.query('SELECT * FROM edufusion_oral_exam_sessions WHERE id=$1',[id])).rows[0],before);
  }
});

test('historical pending reports cannot starve modern feedback in the bounded background queue',async()=>{
  await database.query("UPDATE edufusion_oral_exam_sessions SET evaluation_status='failed' WHERE evaluation_status='pending'");
  for(let i=0;i<4;i++)await historicalSession(null,'pending');
  const modern=await create();await store.finish(user,modern.id);
  await database.query("UPDATE edufusion_oral_exam_sessions SET status='completed' WHERE id=$1",[modern.id]);
  assert.deepEqual((await store.pendingEvaluations()).map(row=>row.id),[modern.id]);
});
