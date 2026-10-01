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
