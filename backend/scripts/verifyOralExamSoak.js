// Real wall-clock WebSocket/database integration, deterministic voice/model.
// Never accesses a production database or provider. Run separately from unit tests.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {once}=require('node:events');
const WebSocket=require('ws');
const port=5056,base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,[path.join(__dirname,'verifyOralExam.js')],{env:{...process.env,NODE_ENV:'test',ORAL_EXAM_FIXTURE_PORT:String(port),ORAL_EXAM_DIAGNOSTICS:'true'},stdio:['ignore','pipe','pipe'],windowsHide:true});
child.stderr.pipe(process.stderr);child.stdout.pipe(process.stdout);
let socket;
async function main(){
  await new Promise((resolve,reject)=>{child.stdout.on('data',data=>{if(String(data).includes('Isolated Oral Exam fixture:'))resolve();});child.once('exit',code=>reject(new Error(`Fixture exited ${code}`)));});
  const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'99001',password:'fixture-pin'})}).then(r=>r.json());
  const headers={'Content-Type':'application/json',Authorization:`Bearer ${login.token}`};
  const created=await fetch(`${base}/api/oral-exam/sessions`,{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID()},body:JSON.stringify({language:'en',source:{kind:'text',title:'Isolated soak',text:'Routers forward packets between networks. Routing tables contain destinations and next hops. A router chooses a path and forwards packets to the next router.'.repeat(3)}})}).then(r=>r.json());
  const session=await fetch(`${base}/api/oral-exam/sessions/${created.session.id}/start`,{method:'POST',headers,body:'{}'}).then(r=>r.json()).then(r=>r.session);
  const key=randomUUID(),started=Date.now();let clocks=0,welcomes=0,attempt=0;
  const connect=async()=>{
    const ws=new WebSocket(`ws://127.0.0.1:${port}/api/oral-exam/realtime`,{origin:'http://localhost:3110'});socket=ws;
    ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='clock')clocks++;if(msg.type==='welcome'){welcomes++;assert.equal(msg.session.id,session.id);assert.equal(msg.session.expires_at,session.expires_at);}if(msg.type==='audio')ws.send(JSON.stringify({type:'played',sequence:msg.sequence}));});
    await once(ws,'open');ws.send(JSON.stringify({type:'hello',token:login.token,sessionId:session.id,connectionKey:key,connectionAttempt:++attempt}));return ws;
  };
  await connect();
  // Exercise real PCM framing and save completed answers early in the session.
  for(let i=0;i<100;i++){await delay(100);if(socket.readyState===1)socket.send(Buffer.alloc(3200));}
  const get=()=>fetch(`${base}/api/oral-exam/sessions/${session.id}`,{headers}).then(r=>r.json()).then(r=>r.session);
  const before=await get();assert.ok(before.turns.some(turn=>turn.transcript));
  await delay(Math.max(0,190000-(Date.now()-started)));
  assert.equal(socket.readyState,WebSocket.OPEN);assert.ok(clocks>=35);
  const closed=once(socket,'close');socket.terminate();await closed;await connect();
  await delay(20000);
  const after=await get();assert.equal(after.status,'active');assert.equal(after.expires_at,session.expires_at);assert.equal(after.started_at,session.started_at);
  for(const turn of before.turns.filter(turn=>turn.transcript))assert.equal(after.turns.find(t=>t.id===turn.id)?.transcript,turn.transcript);
  assert.equal(welcomes,2);assert.equal(socket.readyState,WebSocket.OPEN);
  console.log(JSON.stringify({event:'soak_pass',elapsed_ms:Date.now()-started,clocks,welcomes,session:session.id,answers:after.turns.filter(t=>t.transcript).length}));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.terminate();child.kill();});
