// Local browser fixture. Never imported by the application or deployed entrypoint.
// Real SQL, authentication, routes and WebSockets; deterministic providers, no network.
if(process.env.NODE_ENV!=='test')throw new Error('Run this isolated browser fixture with NODE_ENV=test');
const {PGlite}=require('@electric-sql/pglite');
process.env.JWT_SECRET='isolated-browser-fixture-not-a-production-secret';
process.env.ORAL_EXAM_ENABLED='true';
process.env.FRONTEND_URL='http://localhost:3110';
for(const key of ['ORAL_EXAM_API_KEY','ELEVENLABS_API_KEY','ELEVENLABS_EN_VOICE_ID','ELEVENLABS_AR_VOICE_ID'])process.env[key]='test-only';
const db=require('../src/db');
const examiner=require('../src/oralExam/examiner');
const store=require('../src/oralExam/store');
const grounding=require('../src/oralExam/grounding');
const answerBytes=process.env.ORAL_EXAM_FIXTURE_SLOW_ANSWERS==='true'?960000:96000;
// Compare the old lease policy using the same runtime and fault proxy. This is
// strictly an isolated test switch, never a production configuration option.
if(process.env.ORAL_EXAM_FIXTURE_LEGACY_CLAIM==='true'){
  const claim=store.claim;store.claim=(user,id)=>claim(user,id);
}
const report={understanding:85,accuracy:80,completeness:75,communication:90,strengths:['Explained how routers select paths'],areasForImprovement:['Describe packet forwarding in more detail'],topicsCovered:['Routing'],summary:'You connected path selection to efficient delivery. Practise explaining the steps a packet takes through a router.'};
const assessment={understanding:85,accuracy:80,completeness:75,communication:90,feedback:'You identified path selection correctly.',strengths:report.strengths,improvements:report.areasForImprovement};
// A short WAV tone exercises actual browser decoding/playback without paid TTS.
const wav=()=>{const samples=8000,buffer=Buffer.alloc(44+samples*2);buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(16000,24);buffer.writeUInt32LE(32000,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)buffer.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/16000)*700),44+i*2);return buffer;};
async function main(){
  const database=await PGlite.create();
  db.pool.query=async(sql,params=[])=>{const result=!params.length&&sql.split(';').length>2?(await database.exec(sql)).at(-1):await database.query(sql,params);return {rows:result.rows||[],rowCount:result.affectedRows||result.rows?.length||0};};
  let tail=Promise.resolve();db.pool.connect=async()=>{const previous=tail;let release;tail=new Promise(r=>{release=r;});await previous;return {query:db.pool.query,release};};
  await require('./migrate').migrate();
  await database.query("INSERT INTO students(id_student,student_name,pin_hash,pin_format) VALUES(99001,'Browser Test Student','fixture-pin','legacy')");
  global.fetch=async(url,options)=>{if(url!==require('../src/oralExam/modelProvider').oralExam.endpoint())throw new Error('Fixture blocks external network');const grounded=JSON.parse(options.body).response_format.json_schema.schema.properties.summary.enum;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(grounded?{summary:'practice',strength_ids:[],improvement_ids:[]}:{summary:report.summary,strengths:report.strengths,areasForImprovement:report.areasForImprovement})}}]}));};
  if(process.env.ORAL_EXAM_FIXTURE_REPORTS==='true'){
    const user={id_student:99001},plan=Array.from({length:5},(_,i)=>({name:['Routing','Switching','Addressing','Forwarding','Default routes'][i],citations:['text-1']}));
    const row=await store.create(user,{source:{kind:'text',digest:'report-fixture'},title:'Networks — report recovery test',context:{chunks:[{id:'text-1',section:'Networks',text:'Routers select paths. Switches connect local devices. Addresses identify destinations. Forwarding uses next hops. Default routes handle other destinations.'}]}},'en',require('node:crypto').randomUUID());
    await database.query("UPDATE edufusion_oral_exam_sessions SET context=context-'grounding_version' WHERE id=$1",[row.id]);
    await store.start(user,row.id);const lease=await store.claim(user,row.id);
    const q=i=>({question:'Explain '+plan[i].name,concept:plan[i].name,question_type:i?'next_topic':'initial',difficulty:'foundation',citations:['text-1'],follow_up_reason:''});
    await store.commit(row.id,lease.token,0,null,{assessment:null,core_concepts:plan,next:q(0)});
    for(let i=0;i<5;i++)await store.commit(row.id,lease.token,i+1,'An explanation of '+plan[i].name,{assessment,next:i<4?q(i+1):null});
    await store.ensureCore(user,row.id);
    const goodFetch=global.fetch;global.fetch=async()=>new Response('{}',{status:503});
    await examiner.evaluate(user,row.id);global.fetch=goodFetch;
    console.log('Report recovery fixture: '+row.id);
  }
  const app=require('../src/app');
  const port=Number(process.env.ORAL_EXAM_FIXTURE_PORT||5000);
  const server=app.listen(port,'127.0.0.1',()=>console.log(`Isolated Oral Exam fixture: http://localhost:${port}; student 99001 / fixture-pin`));
  const fixtureNext=async(session,text)=>{
    const current=session.turns.at(-1),evidence=session.context.chunks,criterion=grounding.catalog(evidence)[0];
    const assessed=text===null?null:grounding.assess({grounding:{citations:current.citations,criteria:current.grading_criteria.map(c=>({criterion_id:c.id,level:'partial',answer_quote:text}))},communication:'clear'},current,grounding.evidenceFor(session),text,session.language);
    const questions=['How do routers forward packets?','Explain how routers forward packets.','Describe routers forwarding packets.','Why do routers forward packets between networks?'];
    const q=grounding.rubric({question:questions[Math.min(session.turns.length,3)],concept:session.turns.length<3?'Routing':'Forwarding',question_type:text===null?'initial':session.turns.length===3?'next_topic':'follow_up',difficulty:'foundation',citations:criterion.citations,criterion_ids:[criterion.id],follow_up_reason:'Probe packet forwarding'},evidence,current,assessed);
    return {assessment:assessed,next:q,core_concepts:text===null?[{name:'Routing',citations:criterion.citations},{name:'Forwarding',citations:criterion.citations}]:null};
  };
  const realtime=require('../src/oralExam/realtime').attachRealtime(server,{examiner:{...examiner,next:fixtureNext},voice:{speak:async()=>wav(),transcriber:({onFinal})=>{
    let bytes=0,done=false;return {opened:Promise.resolve(),close(){done=true;},send(chunk){bytes+=chunk.length;if(bytes>=answerBytes&&!done){done=true;onFinal('A router chooses a path and forwards packets between networks.');}return true;}};
  }}});
  // Safe local-only ownership snapshots for long-duration fault verification.
  app.get('/__fixture/session/:id',async(req,res)=>{
    try {
      const session=await store.get({id_student:99001},req.params.id);
      res.json({id:session.id,status:session.status,started_at:session.started_at,expires_at:session.expires_at,server_now:session.server_now,
        lease_until:session.lease_until,leased:Boolean(session.lease_token),has_client_key:Boolean(session.lease_client_id),
        connected_clients:realtime.wss.clients.size,turns:session.turns.map(t=>({sequence:t.sequence,answered:Boolean(t.transcript),assessed:Boolean(t.assessment)}))});
    }catch{res.status(404).json({error:'Fixture session not found'});}
  });
  const close=()=>{realtime.close();server.close(async()=>{await database.close();await db.pool.end();});};process.once('SIGINT',close);process.once('SIGTERM',close);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
