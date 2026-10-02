const assert=require('node:assert/strict');
const {test,before,after}=require('node:test');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
process.env.NODE_ENV='test';process.env.JWT_SECRET='grounded-test-secret-at-least-32-characters';
const db=require('../src/db'),store=require('../src/oralExam/store'),examiner=require('../src/oralExam/examiner'),g=require('../src/oralExam/grounding');
const user={id_student:940};
const evidence=[{id:'text-1',section:'UDP',text:'UDP does not guarantee delivery. Packet loss may reduce media quality. Sequence numbers help identify missing or reordered packets.'},{id:'text-2',section:'DNS',text:'DNS translates domain names into IP addresses.'}];
const material={source:{kind:'text',digest:'grounding-adversarial'},title:'Closed source',context:{chunks:evidence}};
const criteria=g.catalog(evidence),udp=criteria[0],sequence=criteria[2],dns=criteria[3];
const proposal=(overrides={})=>({question:'What does UDP guarantee?',concept:'UDP',question_type:'initial',difficulty:'foundation',citations:['text-1'],criterion_ids:[udp.id],follow_up_reason:'',...overrides});
const current={sequence:1,question:'What does UDP guarantee?',concept:'UDP',question_type:'initial',category:'core',citations:['text-1'],grading_criteria:[udp],exchanges:[]};
const session=(turn=current)=>({language:'en',expires_at:new Date(Date.now()+600000).toISOString(),server_now:new Date().toISOString(),context:{chunks:evidence,grounding_version:1,oral_policy:{version:1,required_concepts:2,max_follow_ups:2,max_bonus:5},core_plan:[{name:'UDP',citations:['text-1']},{name:'DNS',citations:['text-2']}]},turns:[turn]});
const rawAssessment=(level='met',quote='UDP does not guarantee delivery.',id=udp.id,citations=['text-1'])=>({grounding:{citations,criteria:[{criterion_id:id,level,answer_quote:level==='missing'?'':quote}]},communication:'clear'});
const value=(assessment=rawAssessment(),next=null)=>({intent:'answer',reply:null,assessment,next,transition:null,core_concepts:null});
const response=v=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(v)}}]}));
let database;const original={query:db.pool.query,connect:db.pool.connect,fetch:global.fetch};
before(async()=>{
  database=await PGlite.create();db.pool.query=async(sql,params=[])=>{const r=!params.length&&sql.split(';').length>2?(await database.exec(sql)).at(-1):await database.query(sql,params);return {rows:r.rows||[],rowCount:r.affectedRows||r.rows?.length||0};};
  let tail=Promise.resolve();db.pool.connect=async()=>{const previous=tail;let release;tail=new Promise(r=>release=r);await previous;return {query:db.pool.query,release};};
  await require('../scripts/migrate').migrate();await database.query("INSERT INTO students(id_student,student_name,pin_hash) VALUES(940,'Grounding fixture','hash')");
});
after(async()=>{db.pool.query=original.query;db.pool.connect=original.connect;global.fetch=original.fetch;await database.close();await db.pool.end();});
test('rubric is a closed selection of complete source units, not arbitrary quoted substrings',()=>{
  assert.deepEqual(g.rubric(proposal(),evidence).grading_criteria,[udp]);
  assert.throws(()=>g.rubric(proposal({criterion_ids:['invented']}),evidence),{code:'unsupported_rubric'});
  const q=g.rubric(proposal(),evidence);q.grading_criteria[0]={...udp,criterion:'UDP guarantees delivery.'};assert.throws(()=>g.storedRubric(q,evidence),{code:'altered_rubric'});
});
for(const technique of ['forward error correction','client-side prediction','state interpolation','redundant packet sending'])test(`unsupported technique is rejected despite valid chunk citation: ${technique}`,async()=>{
  let calls=0;global.fetch=async()=>{calls++;return response(value({...rawAssessment(),feedback:'Mention '+technique,improvements:['Explain '+technique]}));};
  await assert.rejects(()=>examiner.next(session(),'UDP does not guarantee delivery.'),{name:'ZodError'});assert.equal(calls,2);
});
test('unsupported completeness penalty cannot enter the closed assessment contract',async()=>{
  global.fetch=async()=>response(value({...rawAssessment(),completeness:10,feedback:'The student omitted client-side prediction.'}));
  await assert.rejects(()=>examiner.next(session(),'UDP does not guarantee delivery.'),{name:'ZodError'});
  const grounded=g.assess(rawAssessment(),current,[evidence[0]],'UDP does not guarantee delivery.','en');assert.equal(grounded.completeness,100);
});
test('a grounding rejection can recover on the second bounded attempt',async()=>{
  let calls=0;global.fetch=async()=>response(++calls===1?value({...rawAssessment(),feedback:'Mention client-side prediction.'}):value());
  const accepted=await examiner.next(session(),'UDP does not guarantee delivery.');assert.equal(calls,2);assert.equal(accepted.assessment.completeness,100);assert.ok(!JSON.stringify(accepted.assessment).includes('prediction'));
});
test('Arabic feedback remains source-linked and question scaffolding permits source terms',()=>{
  assert.ok(g.rubric(proposal({question:'ما وظيفة UDP؟'}),evidence));
  const a=g.assess(rawAssessment(),current,[evidence[0]],'UDP does not guarantee delivery.','ar');assert.equal(a.understanding,100);assert.ok(a.strengths[0].includes(udp.criterion));assert.match(a.feedback,/المادة/);
});
test('grounded improvement maps to a saved sequence-number criterion',()=>{
  const turn={...current,question:'Explain sequence numbers.',grading_criteria:[sequence]};
  const a=g.assess(rawAssessment('partial','Numbers identify packets.',sequence.id),turn,[evidence[0]],'Numbers identify packets.','en');
  assert.equal(a.completeness,60);assert.deepEqual(a.improvements,['Review this source point: '+sequence.criterion]);assert.ok(!JSON.stringify(a).includes('prediction'));
});
test('current assessment scope excludes future evidence while next question can use it',async()=>{
  let input;global.fetch=async(_url,options)=>{input=JSON.parse(JSON.parse(options.body).messages[1].content);return response(value(rawAssessment(),proposal({question:'What does DNS translate?',concept:'DNS',question_type:'next_topic',citations:['text-2'],criterion_ids:[dns.id]})));};
  const v=await examiner.next(session(),'UDP does not guarantee delivery.');
  assert.deepEqual(input.assessment_evidence.map(c=>c.id),['text-1']);assert.ok(input.question_generation_evidence.some(c=>c.id==='text-2'));assert.deepEqual(v.next.grading_criteria,[dns]);
  global.fetch=async()=>response(value(rawAssessment('met','UDP does not guarantee delivery.',dns.id,['text-2'])));
  await assert.rejects(()=>examiner.next(session(),'UDP does not guarantee delivery.'),{code:'assessment_evidence_scope'});
});
test('a valid citation cannot substitute a criterion from another question or fabricate an answer quote',()=>{
  assert.throws(()=>g.assess(rawAssessment('met','UDP does not guarantee delivery.',sequence.id),current,[evidence[0]],'UDP does not guarantee delivery.','en'),{code:'assessment_criterion_scope'});
  assert.throws(()=>g.assess(rawAssessment('met','fabricated answer'),current,[evidence[0]],'UDP does not guarantee delivery.','en'),{code:'unsupported_answer_quote'});
});
test('follow-up must target a missing persisted criterion, never future/general knowledge',()=>{
  const a=g.assess(rawAssessment('partial','UDP.'),current,[evidence[0]],'UDP.','en');
  assert.ok(g.rubric(proposal({question:'Explain UDP delivery.',question_type:'follow_up'}),evidence,current,a));
  assert.throws(()=>g.rubric(proposal({question:'Explain forward error correction.',question_type:'follow_up'}),evidence,current,a),{code:'unsupported_question_term'});
  assert.throws(()=>g.rubric(proposal({question:'Explain sequence numbers.',concept:'Sequence numbers',question_type:'follow_up',criterion_ids:[sequence.id]}),evidence,current,a),{code:'unsupported_follow_up'});
  const complete=g.assess(rawAssessment(),current,[evidence[0]],'UDP does not guarantee delivery.','en');assert.throws(()=>g.rubric(proposal({question_type:'follow_up'}),evidence,current,complete),{code:'unsupported_follow_up'});
});
test('bonus questions accept source-derived applications and reject absent industry techniques',()=>{
  assert.ok(g.rubric(proposal({question:'Why would you choose UDP when packet loss may reduce media quality?',question_type:'bonus',criterion_ids:[udp.id,criteria[1].id]}),evidence));
  assert.throws(()=>g.rubric(proposal({question:'Which forward error correction would you use?',question_type:'bonus'}),evidence),{code:'unsupported_question_term'});
});
test('final commentary cannot add prose/academic claims or select unvalidated topics',()=>{
  const core={strengths:['Source point'],areasForImprovement:['Review a source point']};
  assert.throws(()=>g.groundedCommentary.parse({summary:'Discuss client-side prediction.',strength_ids:[],improvement_ids:[]}),{name:'ZodError'});
  assert.throws(()=>g.finalCommentary({summary:'practice',strength_ids:[],improvement_ids:[1]},core,'en'),{code:'unsupported_commentary_reference'});
  assert.deepEqual(g.finalCommentary({summary:'practice',strength_ids:[0],improvement_ids:[0]},core,'en').areasForImprovement,core.areasForImprovement);
});
test('a forged numeric score is not accepted as a grounded saved assessment',()=>{
  const a=g.assess(rawAssessment(),current,[evidence[0]],'UDP does not guarantee delivery.','en');assert.throws(()=>g.storedAssessment({...a,completeness:1},current,[evidence[0]],'UDP does not guarantee delivery.','en'),{code:'altered_grounded_assessment'});
});
test('a grounded follow-up persists under fencing and keeps the verified 60/40 arithmetic',async()=>{
  const row=await store.create(user,material,'en',randomUUID());await store.start(user,row.id);const lease=await store.claim(user,row.id);const q=g.rubric(proposal(),evidence);
  await store.commit(row.id,lease.token,0,null,{assessment:null,next:q,core_concepts:[{name:'UDP',citations:['text-1']}]});let saved=await store.get(user,row.id);
  const text='UDP.',a=g.assess(rawAssessment('partial',text),saved.turns[0],g.evidenceFor(saved),text,'en');
  const follow=g.rubric(proposal({question:'Explain UDP delivery.',question_type:'follow_up'}),evidence,saved.turns[0],a);
  await store.commit(row.id,lease.token,1,text,{assessment:a,next:follow});saved=await store.get(user,row.id);assert.equal(saved.turns[1].parent_sequence,1);
  const answer='UDP does not guarantee delivery.',b=g.assess(rawAssessment(),saved.turns[1],g.evidenceFor(saved),answer,'en');
  await store.commit(row.id,lease.token,2,answer,{assessment:b,next:null});saved=await store.ensureCore(user,row.id);
  assert.equal(saved.core_evaluation.understanding,76);assert.equal(saved.core_evaluation.score,78);
});
test('private rubric is persisted, absent from public payloads, and ungrounded writes fail closed',async()=>{
  const row=await store.create(user,material,'en',randomUUID());assert.equal(row.context.grounding_version,1);await store.start(user,row.id);const lease=await store.claim(user,row.id);
  const q=g.rubric(proposal(),evidence);await store.commit(row.id,lease.token,0,null,{next:q,assessment:null,core_concepts:[{name:'UDP',citations:['text-1']}]});
  let saved=await store.get(user,row.id);assert.deepEqual(saved.turns[0].grading_criteria,[udp]);assert.ok(!JSON.stringify(store.publicView(saved)).includes('grading_criteria'));assert.ok(!JSON.stringify(store.publicView(saved)).includes(udp.criterion));
  const answer='UDP does not guarantee delivery.';await store.recordAnswer(row.id,lease.token,1,answer);
  let attempts=0;global.fetch=async()=>{attempts++;return response(value({...rawAssessment(),improvements:['Mention forward error correction.']}));};
  await assert.rejects(()=>examiner.next(saved,answer),{name:'ZodError'});assert.equal(attempts,2);
  saved=await store.get(user,row.id);assert.equal(saved.turns[0].transcript,answer);assert.equal(saved.turns[0].assessment,null);
  await assert.rejects(()=>store.commit(row.id,lease.token,1,answer,{assessment:{understanding:1,accuracy:1,completeness:1,communication:1,feedback:'Mention FEC'},next:null}),{code:'ungrounded_assessment'});
  const a=g.assess(rawAssessment(),saved.turns[0],g.evidenceFor(saved),answer,'en');await store.commit(row.id,lease.token,1,answer,{assessment:a,next:null});
  saved=await store.ensureCore(user,row.id);assert.equal(saved.core_evaluation.score,100);assert.equal(saved.turns[0].assessment.grounding.version,1);
  global.fetch=async()=>response({summary:'Study forward error correction.',strength_ids:[],improvement_ids:[]});assert.equal((await examiner.evaluate(user,row.id)).status,'failed');assert.equal((await store.get(user,row.id)).core_evaluation.score,100);
  global.fetch=async()=>response({summary:'completed',strength_ids:[0],improvement_ids:[]});assert.equal((await examiner.evaluate(user,row.id)).status,'ready');
  assert.equal((await store.get(user,row.id)).core_evaluation.score,100);
});

test('source topic label may name its cited chunk while the question and rubric remain restricted to the selected source sentence',()=>{
 const loss=criteria[1];const q=proposal({question:'How does packet loss affect media quality?',concept:'UDP',criterion_ids:[loss.id]});assert.deepEqual(g.rubric(q,evidence).grading_criteria,[loss]);assert.throws(()=>g.rubric({...q,concept:'forward error correction'},evidence),{code:'unsupported_question_term'});assert.throws(()=>g.rubric({...q,question:'How does forward error correction affect media quality?'},evidence),{code:'unsupported_question_term'});
});
const dnsProposal=()=>proposal({question:'What does DNS translate?',concept:'DNS',question_type:'next_topic',citations:['text-2'],criterion_ids:[dns.id]});
const unsupportedFollow=()=>proposal({question:'Explain forward error correction.',question_type:'follow_up'});
async function savedAnswer(level='partial'){
  const row=await store.create(user,material,'en',randomUUID());await store.start(user,row.id);const lease=await store.claim(user,row.id);
  await store.commit(row.id,lease.token,0,null,{assessment:null,next:g.rubric(proposal(),evidence),core_concepts:[{name:'UDP',citations:['text-1']},{name:'DNS',citations:['text-2']}]});
  const s=await store.get(user,row.id),text=level==='met'?'UDP does not guarantee delivery.':'UDP.';
  const a=g.assess(rawAssessment(level,text),s.turns[0],g.evidenceFor(s),text,'en');
  await store.recordAnswer(row.id,lease.token,1,text);await store.saveAssessment(row.id,lease.token,1,text,a);
  return {row,lease,text,a,s:await store.get(user,row.id)};
}
test('invalid next shape, rubric, duplicate and progression reject only next, without reassessment',async()=>{
  for(const next of [unsupportedFollow(),{invalid:true},proposal({criterion_ids:['invented']}),proposal(),dnsProposal()]){
    const s=session();if(next.concept==='DNS')s.context.core_plan=[{name:'UDP',citations:['text-1']}];
    let calls=0;global.fetch=async()=>{calls++;return response(value(rawAssessment(),next));};
    const result=await examiner.next(s,'UDP does not guarantee delivery.');assert.equal(calls,1);assert.equal(result.assessment.completeness,100);assert.equal(result.next,null);assert.ok(result.next_error);
  }
});
test('valid assessment is saved before rejected follow-up recovery and one recovery persists a grounded follow-up unchanged',async()=>{
  const p=await savedAnswer();let calls=0;
  global.fetch=async(_url,options)=>{calls++;const input=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(input.question_type,'follow_up');assert.deepEqual(input.source_criteria,[udp]);assert.equal((await store.get(user,p.row.id)).turns[0].assessment.completeness,60);return response({next:proposal({question:'Explain UDP delivery.',question_type:'follow_up'})});};
  const next=await examiner.recoverNext(p.s);assert.equal(calls,1);await store.commit(p.row.id,p.lease.token,1,null,{assessment:null,next});
  const after=await store.get(user,p.row.id);assert.deepEqual(after.turns[0].assessment,p.a);assert.equal(after.turns[1].category,'follow_up');assert.equal(after.turns[1].parent_sequence,1);assert.equal(+after.expires_at,+p.s.expires_at);await store.finish(user,p.row.id);
});
test('failed follow-up recovery advances to the next uncovered core without reassessing or extending time',async()=>{
  const p=await savedAnswer();let calls=0;
  global.fetch=async(_url,options)=>{const input=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(input.question_type,calls?'next_topic':'follow_up');return response({next:++calls===1?unsupportedFollow():dnsProposal()});};
  const next=await examiner.recoverNext(p.s);assert.equal(calls,1);assert.equal(next.question,'Explain DNS.');await store.commit(p.row.id,p.lease.token,1,null,{assessment:null,next});
  const after=await store.get(user,p.row.id);assert.deepEqual(after.turns[0].assessment,p.a);assert.equal(after.turns[1].concept,'DNS');assert.equal(+after.expires_at,+p.s.expires_at);await store.finish(user,p.row.id);
});
test('unsafe recovery with no source-derived fallback closes safely with the authoritative assessment saved',async()=>{
  const p=await savedAnswer();await database.query("UPDATE edufusion_oral_exam_sessions SET context=jsonb_set(context,'{core_plan}',$2::jsonb) WHERE id=$1",[p.row.id,JSON.stringify([{name:'UDP',citations:['text-1']},{name:'Absent concept',citations:['text-2']}])]);p.s=await store.get(user,p.row.id);
  let calls=0;global.fetch=async()=>{calls++;return response({next:unsupportedFollow()});};
  const next=await examiner.recoverNext(p.s);assert.equal(calls,1);assert.equal(next,null);await store.commit(p.row.id,p.lease.token,1,null,{assessment:null,next});
  const after=await store.ensureCore(user,p.row.id);assert.equal(after.status,'completed');assert.equal(after.turns.length,1);assert.deepEqual(after.turns[0].assessment,p.a);assert.equal(after.core_evaluation.assessed_answers,1);assert.equal(+after.expires_at,+p.s.expires_at);
});
test('last fifteen seconds close without a recovery call and preserve the assessed answer',async()=>{
  const p=await savedAnswer();let calls=0;global.fetch=async()=>{calls++;throw Error('Unexpected model call');};
  assert.equal(await examiner.recoverNext({...p.s,expires_at:new Date(Date.now()+14000)}),null);assert.equal(calls,0);await store.commit(p.row.id,p.lease.token,1,null,{assessment:null,next:null});assert.deepEqual((await store.get(user,p.row.id)).turns[0].assessment,p.a);
});
test('an authoritative grade cannot be overwritten, duplicated or appended by a fenced recovery owner',async()=>{
  const p=await savedAnswer(),key=randomUUID();await store.release(p.row.id,p.lease.token);const owner=await store.claim(user,p.row.id,key,1);
  await store.saveAssessment(p.row.id,owner.token,1,p.text,p.a);
  await assert.rejects(()=>store.saveAssessment(p.row.id,owner.token,1,p.text,{...p.a,completeness:0}),{statusCode:409});
  const next=g.rubric(dnsProposal(),evidence);
  await assert.rejects(()=>store.commit(p.row.id,p.lease.token,1,null,{assessment:null,next}),{statusCode:409});
  await store.commit(p.row.id,owner.token,1,null,{assessment:null,next});await assert.rejects(()=>store.commit(p.row.id,owner.token,1,null,{assessment:null,next}),{statusCode:409});
  const after=await store.get(user,p.row.id);assert.equal(after.turns.length,2);assert.deepEqual(after.turns[0].assessment,p.a);await store.finish(user,p.row.id);
});
test('recovery offers a source-grounded bonus only after all planned core concepts',async()=>{
  const p=await savedAnswer('met');await database.query("UPDATE edufusion_oral_exam_sessions SET context=jsonb_set(context,'{core_plan}',$2::jsonb) WHERE id=$1",[p.row.id,JSON.stringify([{name:'UDP',citations:['text-1']}])]);
  const s=await store.get(user,p.row.id);let calls=0;global.fetch=async(_url,options)=>{calls++;const input=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(input.question_type,'bonus');return response({next:proposal({question:'Why would you choose UDP?',question_type:'bonus'})});};
  const next=await examiner.recoverNext(s);assert.equal(calls,1);await store.commit(p.row.id,p.lease.token,1,null,{assessment:null,next});assert.equal((await store.get(user,p.row.id)).turns[1].category,'bonus');await store.finish(user,p.row.id);
});
test('invalid bonus generation uses a grounded source comparison after both cores, preserving every grade',async()=>{
  const p=await savedAnswer('met');const next=g.rubric(dnsProposal(),evidence);
  await store.commit(p.row.id,p.lease.token,1,null,{assessment:null,next});
  let s=await store.get(user,p.row.id);const text='DNS translates domain names into IP addresses.';
  const a=g.assess(rawAssessment('met',text,dns.id,['text-2']),s.turns[1],[evidence[1]],text,'en');
  await store.recordAnswer(p.row.id,p.lease.token,2,text);await store.saveAssessment(p.row.id,p.lease.token,2,text,a);s=await store.get(user,p.row.id);
  let calls=0;global.fetch=async()=>{calls++;return response({next:unsupportedFollow()});};
  const bonus=await examiner.recoverNext(s);assert.equal(calls,1);assert.equal(bonus.question_type,'bonus');assert.equal(bonus.question,'Compare UDP and DNS.');g.storedRubric(bonus,evidence);
  await store.commit(p.row.id,p.lease.token,2,null,{assessment:null,next:bonus});const after=await store.get(user,p.row.id);
  assert.deepEqual(after.turns.slice(0,2).map(t=>t.assessment),s.turns.map(t=>t.assessment));assert.equal(after.turns[2].category,'bonus');assert.equal(+after.expires_at,+s.expires_at);await store.finish(user,p.row.id);
});
test('source fallback never opens an uncovered core or bonus in the final minute',async()=>{
  const p=await savedAnswer('met');let calls=0;global.fetch=async()=>{calls++;throw Error('Unexpected model call');};
  assert.equal(await examiner.recoverNext({...p.s,expires_at:new Date(Date.now()+55000)}),null);assert.equal(calls,0);await store.finish(user,p.row.id);
});
test('source fallback selects the target source unit instead of an earlier topic mentioning it',()=>{
  const {sourceNext}=require('../src/oralExam/sourceNext');
  const chunks=[{id:'text-1',text:'DHCP: DHCP supplies an address and DNS server. DNS: DNS translates domain names into addresses.'}];
  const next=sourceNext({language:'en',context:{chunks},turns:[]},{name:'DNS'});
  assert.deepEqual(next.criterion_ids,['text-1:1']);assert.equal(g.rubric(next,chunks).grading_criteria[0].criterion,'DNS: DNS translates domain names into addresses.');
});
test('reconnect during next recovery preserves the committed grade and fences the old proposal without duplicate turns',async()=>{
  process.env.ORAL_EXAM_ENABLED='true';for(const k of ['GROQ_API_KEY','ELEVENLABS_API_KEY','ELEVENLABS_EN_VOICE_ID','ELEVENLABS_AR_VOICE_ID'])process.env[k]='fixture-only';
  const {once}=require('node:events'),WebSocket=require('ws');
  const row=await store.create(user,material,'en',randomUUID());await store.start(user,row.id);const initial=await store.claim(user,row.id);
  await store.commit(row.id,initial.token,0,null,{assessment:null,next:g.rubric(proposal(),evidence),core_concepts:[{name:'UDP',citations:['text-1']},{name:'DNS',citations:['text-2']}]});await store.release(row.id,initial.token);
  let onFinal,assessmentCalls=0,recoveryCalls=0,releaseOld;
  global.fetch=async(_url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).messages[1].content);
    if(Object.hasOwn(input,'student_response')){assessmentCalls++;return response(value(rawAssessment('partial','UDP.'),unsupportedFollow()));}
    recoveryCalls++;
    if(recoveryCalls===1)return new Promise(resolve=>{releaseOld=()=>resolve(response({next:proposal({question:'Explain UDP delivery.',question_type:'follow_up'})}));});
    return response({next:proposal({question:'Describe UDP delivery.',question_type:'follow_up'})});
  };
  const server=require('node:http').createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const runtime=require('../src/oralExam/realtime').attachRealtime(server,{authenticate:async()=>({user,expires:Date.now()+600000}),examiner:{...examiner,evaluate:async()=>{}},voice:{speak:async()=>Buffer.from('ID3fixture'),transcriber:options=>{onFinal=options.onFinal;return {opened:Promise.resolve(),send:()=>true,close(){}};}}});
  const clients=[],key=randomUUID();
  const connect=async attempt=>{const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/api/oral-exam/realtime`,{origin:'http://localhost:3000'}),events=[];clients.push(ws);ws.on('message',raw=>events.push(JSON.parse(raw)));await once(ws,'open');ws.send(JSON.stringify({type:'hello',token:'fixture',sessionId:row.id,connectionKey:key,connectionAttempt:attempt}));return {ws,events};};
  const until=async fn=>{const end=Date.now()+5000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Recovery assertion timed out');};
  try{
    const first=await connect(1);await until(()=>first.events.some(e=>e.type==='audio'));first.ws.send(JSON.stringify({type:'played',sequence:1}));await until(()=>first.events.some(e=>e.state==='listening'));onFinal('UDP.');await until(()=>recoveryCalls===1);
    const saved=await store.get(user,row.id);assert.equal(saved.turns[0].assessment.completeness,60);assert.equal(saved.turns.length,1);
    const second=await connect(2);await until(()=>second.events.some(e=>e.type==='question'&&e.sequence===2));releaseOld();await new Promise(r=>setTimeout(r,30));
    const after=await store.get(user,row.id);assert.equal(assessmentCalls,1);assert.equal(recoveryCalls,2);assert.deepEqual(after.turns[0].assessment,saved.turns[0].assessment);assert.equal(after.turns.length,2);assert.equal(after.turns[1].question,'Describe UDP delivery.');assert.equal(+after.expires_at,+saved.expires_at);assert.ok(!second.events.find(e=>e.type==='question').transition);assert.ok(!first.events.some(e=>e.type==='error'));assert.ok(!second.events.some(e=>e.type==='error'));
  }finally{releaseOld?.();for(const c of clients)c.terminate();runtime.close();await new Promise(r=>server.close(r));await store.finish(user,row.id);}
});
