const assert = require('node:assert/strict');
const {test, before, after} = require('node:test');
const {once} = require('node:events');
const {randomUUID} = require('node:crypto');
const {PGlite} = require('@electric-sql/pglite');
const WebSocket = require('ws');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-reliability-test-secret-at-least-32';
process.env.ORAL_EXAM_ENABLED = 'true';
for (const key of ['GROQ_API_KEY','ELEVENLABS_API_KEY','ELEVENLABS_EN_VOICE_ID','ELEVENLABS_AR_VOICE_ID']) process.env[key] = 'test-only';
const db = require('../src/db');
const store = require('../src/oralExam/store');
const {attachRealtime} = require('../src/oralExam/realtime');
const user = {id_student: 990};
const material = {source:{kind:'text',digest:'lifecycle'},title:'Lifecycle fixture',context:{chunks:[{id:'text-1',text:'Routers forward packets.',section:'Networks'}]}};
let database, server, realtime, runtimeDependencies;
const finalizers=[];
const original = {query:db.pool.query,connect:db.pool.connect};
before(async () => {
  database = await PGlite.create();
  db.pool.query = async (sql, params=[]) => {
    const result = !params.length && sql.split(';').length>2 ? (await database.exec(sql)).at(-1) : await database.query(sql,params);
    return {rows:result.rows||[],rowCount:result.affectedRows||result.rows?.length||0};
  };
  let tail=Promise.resolve();
  db.pool.connect=async()=>{const previous=tail;let release;tail=new Promise(r=>{release=r;});await previous;return {query:db.pool.query,release};};
  await require('../scripts/migrate').migrate();
  await database.query("INSERT INTO students(id_student,student_name,pin_hash) VALUES(990,'Reliability fixture','hash')");
  server=require('../src/app').listen(0,'127.0.0.1');
  await once(server,'listening');
  runtimeDependencies={
    authenticate:async()=>({user,expires:Date.now()+3600000}),
    examiner:{next:async(_session,text)=>({assessment:text===null?null:{feedback:'Saved fixture answer.'},next:{question:'How do routers forward packets?',concept:'Routing',question_type:text===null?'initial':'follow_up',difficulty:'foundation',citations:['text-1'],follow_up_reason:''}}),evaluate:async()=>{}},
    voice:{speak:async()=>Buffer.from('ID3fixture'),transcriber:({onFinal})=>{finalizers.push(onFinal);return {opened:Promise.resolve(),send:()=>true,close(){}};}},
  };
  realtime=attachRealtime(server,runtimeDependencies);
});
after(async()=>{
  realtime.close();
  await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  db.pool.query=original.query;db.pool.connect=original.connect;
  await database.close();await db.pool.end();
});
async function session(){
  await store.expire();
  const row=await store.create(user,material,'en',randomUUID());
  return store.start(user,row.id);
}
// Each browser capability numbers its connection attempts, like the real client.
const attempts=new Map();
async function connect(sessionId,connectionKey,options={},targetServer=server,hello={}){
  const ws=new WebSocket(`ws://127.0.0.1:${targetServer.address().port}/api/oral-exam/realtime`,{origin:'http://localhost:3000',...options});
  const events=[];
  ws.on('message',raw=>events.push(JSON.parse(raw)));
  const closed=once(ws,'close');
  await once(ws,'open');
  const connectionAttempt=connectionKey?hello.connectionAttempt??attempts.set(connectionKey,(attempts.get(connectionKey)||0)+1).get(connectionKey):undefined;
  ws.send(JSON.stringify({type:'hello',sessionId,token:'isolated-auth',connectionKey,connectionAttempt,...hello}));
  const until=async predicate=>{
    const deadline=Date.now()+7000;
    while(Date.now()<deadline){const event=events.find(predicate);if(event)return event;await new Promise(r=>setTimeout(r,10));}
    throw new Error('Expected lifecycle event did not arrive');
  };
  return {ws,events,closed,until};
}
test('a reconnect can fence its still-registered previous socket without admitting another tab',async()=>{
  const row=await session();
  const key=randomUUID(),first=await connect(row.id,key);
  try {
    const welcome=await first.until(e=>e.type==='welcome');
    assert.equal(welcome.session.lease_client_id,undefined);
    assert.equal(welcome.session.lease_token,undefined);
    await first.until(e=>e.type==='question');
    const saved=await store.get(user,row.id);
    const secondTab=await connect(row.id,randomUUID());
    await secondTab.until(e=>e.type==='error');
    assert.equal(secondTab.events.some(e=>e.type==='welcome'),false);
    await secondTab.closed;
    const resumed=await connect(row.id,key);
    try {
      await resumed.until(e=>e.type==='welcome');
      await resumed.until(e=>e.type==='question');
      await first.closed;
      const current=await store.get(user,row.id);
      assert.notEqual(current.lease_token,saved.lease_token);
      await store.release(row.id,saved.lease_token);
      assert.ok(await store.renew(row.id,current.lease_token));
      const after=await store.get(user,row.id);
      assert.equal(+new Date(after.expires_at),+new Date(saved.expires_at));
      assert.equal(after.turns.length,1);
      await assert.rejects(()=>store.recordAnswer(row.id,saved.lease_token,1,'Stale answer'),{statusCode:409});
    } finally {resumed.ws.terminate();await resumed.closed;}
  } finally {first.ws.terminate();await first.closed;await store.finish(user,row.id);}
});
test('an expired lease with no second owner closes retryably rather than claiming another tab exists',async()=>{
  const row=await session();
  const connection=await connect(row.id);
  try {
    await connection.until(e=>e.type==='welcome');
    await database.query("UPDATE edufusion_oral_exam_sessions SET lease_until=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",[row.id]);
    const [code,reason]=await connection.closed;
    assert.equal(code,4500,`Unexpected close: ${code} ${reason}`);
    assert.doesNotMatch(reason.toString(),/elsewhere/);
    assert.equal((await store.get(user,row.id)).status,'active');
  } finally {connection.ws.terminate();await store.finish(user,row.id);}
});
test('late release and another browser capability cannot clear or steal the current lease',async()=>{
  const row=await session();
  try {
    const key=randomUUID(),first=await store.claim(user,row.id,key,1);
    const second=await store.claim(user,row.id,key,2);
    await store.release(row.id,first.token);
    assert.ok(await store.renew(row.id,second.token));
    assert.equal(await store.renew(row.id,first.token),undefined);
    assert.equal((await store.finish(user,row.id,'student_ended',first.token)).status,'active');
    await assert.rejects(()=>store.claim(user,row.id,first.token,1),{statusCode:409});
    await assert.rejects(()=>store.claim(user,row.id,randomUUID()),{statusCode:409});
    await store.release(row.id,second.token);
    const third=await store.claim(user,row.id,randomUUID());
    assert.ok(third.token);
    await assert.rejects(()=>store.claim(user,row.id,key,3),{statusCode:409});
  } finally {await store.finish(user,row.id);}
});
test('rapid reconnects recover a lost welcome while rotating every write lease',async()=>{
  const row=await session(),key=randomUUID(),first=await connect(row.id,key);
  const clients=[first];
  try {
    await first.until(e=>e.type==='question');
    const before=await store.get(user,row.id);
    for(let i=0;i<3;i++){
      const next=await connect(row.id,key);clients.push(next);
      await next.until(e=>e.type==='welcome');
      await next.until(e=>e.type==='question');
      await clients[clients.length-2].closed;
    }
    const after=await store.get(user,row.id);
    assert.equal(after.turns.length,1);assert.equal(+new Date(after.expires_at),+new Date(before.expires_at));
    assert.equal(await store.renew(row.id,before.lease_token),undefined);
    assert.ok(await store.renew(row.id,after.lease_token));
    assert.equal(realtime.wss.clients.size,1);
  } finally {for(const c of clients){c.ws.terminate();await c.closed;}await store.finish(user,row.id);}
});
test('recovery on a fresh server instance uses persisted ownership and fences the old instance',async()=>{
  const row=await session(),key=randomUUID(),first=await connect(row.id,key);
  const nextServer=require('node:http').createServer();
  nextServer.listen(0,'127.0.0.1');await once(nextServer,'listening');
  const nextRuntime=attachRealtime(nextServer,runtimeDependencies);
  let resumed;
  try {
    await first.until(e=>e.type==='question');
    const before=await store.get(user,row.id);
    resumed=await connect(row.id,key,{},nextServer);
    await resumed.until(e=>e.type==='welcome');await resumed.until(e=>e.type==='question');
    const after=await store.get(user,row.id);
    assert.notEqual(after.lease_token,before.lease_token);
    assert.equal(+new Date(after.expires_at),+new Date(before.expires_at));
    assert.equal(after.turns.length,1);
    await assert.rejects(()=>store.recordAnswer(row.id,before.lease_token,1,'Old instance answer'),{statusCode:409});
    const [code]=await first.closed;assert.equal(code,4409);
    await store.release(row.id,before.lease_token);
    assert.ok(await store.renew(row.id,after.lease_token));
  } finally {
    first.ws.terminate();await first.closed;
    if(resumed){resumed.ws.terminate();await resumed.closed;}
    nextRuntime.close();await new Promise(resolve=>nextServer.close(resolve));await store.finish(user,row.id);
  }
});
test('resume reads completed turns after fencing the old socket',async()=>{
  const row=await session(),key=randomUUID(),first=await connect(row.id,key);
  const claim=store.claim;
  let second;
  try {
    await first.until(e=>e.type==='question');
    const prior=await store.get(user,row.id);
    store.claim=async(...args)=>{
      await store.commit(row.id,prior.lease_token,1,'An already completed answer.',{assessment:{feedback:'Saved.'},next:{question:'Which route is chosen next?',concept:'Routing',question_type:'follow_up',difficulty:'foundation',citations:['text-1'],follow_up_reason:''}});
      return claim(...args);
    };
    second=await connect(row.id,key);
    await second.until(e=>e.type==='question'&&e.sequence===2);
    const saved=await store.get(user,row.id);
    assert.equal(saved.turns.length,2);assert.equal(saved.turns[1].transcript,null);
    assert.equal(saved.turns[0].transcript,'An already completed answer.');
  } finally {store.claim=claim;first.ws.terminate();await first.closed;if(second){second.ws.terminate();await second.closed;}await store.finish(user,row.id);}
});
test('a LectureScribe health 502 leaves the exam status, lease, deadline and turns unchanged',async()=>{
  const row=await session(),lease=await store.claim(user,row.id,randomUUID());
  const fetchImpl=global.fetch;
  try {
    global.fetch=async()=>new Response('{"error":"transcription unavailable"}',{status:502,headers:{'content-type':'application/json'}});
    const before=await store.get(user,row.id);
    const response=await request(server).get('/api/lecture-scribe/health').set('Authorization','Bearer '+jwt.sign(user,process.env.JWT_SECRET,{expiresIn:'24h'}));
    assert.equal(response.status,502);
    const after=await store.get(user,row.id);
    assert.equal(after.status,'active');assert.equal(after.lease_token,lease.token);
    assert.equal(+new Date(after.expires_at),+new Date(before.expires_at));assert.deepEqual(after.turns,before.turns);
  } finally {global.fetch=fetchImpl;await store.finish(user,row.id);}
});
test('duplicate final speech and a late old transcriber cannot create duplicate answers after reconnect',async()=>{
  const row=await session(),key=randomUUID(),first=await connect(row.id,key);
  let second;
  try {
    await first.until(e=>e.type==='audio');first.ws.send(JSON.stringify({type:'played',sequence:1}));
    await first.until(e=>e.type==='state'&&e.state==='listening');
    const oldFinal=finalizers.at(-1);
    oldFinal('First accepted answer.');oldFinal('Duplicate callback.');
    await first.until(e=>e.type==='question'&&e.sequence===2);
    second=await connect(row.id,key);await second.until(e=>e.type==='audio');
    second.ws.send(JSON.stringify({type:'played',sequence:2}));await second.until(e=>e.type==='state'&&e.state==='listening');
    oldFinal('Late duplicate from replaced socket.');finalizers.at(-1)('Second accepted answer.');
    await second.until(e=>e.type==='question'&&e.sequence===3);
    const saved=await store.get(user,row.id);
    assert.equal(saved.turns.length,3);assert.equal(saved.turns[0].transcript,'First accepted answer.');
    assert.equal(saved.turns[1].transcript,'Second accepted answer.');assert.equal(saved.turns[2].transcript,null);
    assert.equal(+new Date(saved.expires_at),+new Date(row.expires_at));
  } finally {first.ws.terminate();await first.closed;if(second){second.ws.terminate();await second.closed;}await store.finish(user,row.id);}
});

test('a claim never lets an older or repeated attempt of the same capability take the lease',async()=>{
  const row=await session();
  try {
    const key=randomUUID(),newer=await store.claim(user,row.id,key,5);
    await assert.rejects(()=>store.claim(user,row.id,key,4),{statusCode:409});
    await assert.rejects(()=>store.claim(user,row.id,key,5),{statusCode:409});
    assert.ok(await store.renew(row.id,newer.token));
    // A normal release frees the lease but still remembers the newest attempt.
    await store.release(row.id,newer.token);
    await assert.rejects(()=>store.claim(user,row.id,key,3),{statusCode:409});
    const next=await store.claim(user,row.id,key,6);
    assert.ok(await store.renew(row.id,next.token));
    const saved=await store.get(user,row.id);
    assert.equal(store.publicView(saved).lease_client_attempt,undefined);
  } finally {await store.finish(user,row.id);}
});
test('overlapping handshakes: a delayed older authentication cannot replace a newer welcomed socket',async()=>{
  let releaseSlowAuth;const slowAuth=new Promise(resolve=>{releaseSlowAuth=resolve;});
  let slowStarted;const slowStart=new Promise(resolve=>{slowStarted=resolve;});
  const racingServer=require('node:http').createServer();
  racingServer.listen(0,'127.0.0.1');await once(racingServer,'listening');
  const racingRuntime=attachRealtime(racingServer,{...runtimeDependencies,authenticate:async token=>{
    if(token==='slow-auth'){slowStarted();await slowAuth;}
    return {user,expires:Date.now()+3600000};
  }});
  const row=await session(),key=randomUUID();
  let older,newer;
  try {
    older=await connect(row.id,key,{},racingServer,{token:'slow-auth',connectionAttempt:1});
    await slowStart;
    newer=await connect(row.id,key,{},racingServer,{connectionAttempt:2});
    await newer.until(e=>e.type==='welcome');await newer.until(e=>e.type==='question');
    const owned=await store.get(user,row.id);
    releaseSlowAuth();
    const [code]=await Promise.race([older.closed,new Promise((_,reject)=>setTimeout(()=>reject(new Error('The older handshake kept the exam')),5000))]);
    assert.equal(code,4429);
    assert.equal(older.events.some(e=>e.type==='welcome'),false);
    // Give any mistaken takeover time to close the newer socket.
    await new Promise(resolve=>setTimeout(resolve,300));
    assert.equal(newer.ws.readyState,WebSocket.OPEN);
    const current=await store.get(user,row.id);
    assert.equal(current.lease_token,owned.lease_token);
    assert.ok(await store.renew(row.id,owned.lease_token));
  } finally {
    releaseSlowAuth();
    for(const c of [older,newer])if(c){c.ws.terminate();await c.closed;}
    racingRuntime.close();await new Promise(resolve=>racingServer.close(resolve));await store.finish(user,row.id);
  }
});

test('provider failure closes the socket and resumes the same saved answer and deadline',async()=>{
  const row=await session(),key=randomUUID(),first=await connect(row.id,key);
  const next=runtimeDependencies.examiner.next;let resumed;
  try {
    await first.until(e=>e.type==='audio');first.ws.send(JSON.stringify({type:'played',sequence:1}));
    await first.until(e=>e.type==='state'&&e.state==='listening');
    runtimeDependencies.examiner.next=async()=>{throw Object.assign(new Error('provider throttled'),{retryAfterMs:1000});};
    finalizers.at(-1)('Saved answer before provider failure.');
    const failed=await first.until(e=>e.type==='error');assert.equal(failed.retryable,true);assert.equal(failed.retry_after_ms,1000);
    assert.equal((await first.closed)[0],4500);
    runtimeDependencies.examiner.next=next;
    resumed=await connect(row.id,key);const welcome=await resumed.until(e=>e.type==='welcome');
    assert.equal(welcome.session.id,row.id);assert.equal(+new Date(welcome.session.expires_at),+new Date(row.expires_at));
    await resumed.until(e=>e.type==='question'&&e.sequence===2);
    const saved=await store.get(user,row.id);assert.equal(saved.turns[0].transcript,'Saved answer before provider failure.');assert.ok(saved.turns[0].assessment);
  } finally {runtimeDependencies.examiner.next=next;first.ws.terminate();if(resumed){resumed.ws.terminate();await resumed.closed;}await store.finish(user,row.id);}
});
