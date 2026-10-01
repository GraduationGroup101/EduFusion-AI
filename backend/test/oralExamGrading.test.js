const {test}=require('node:test');
const assert=require('node:assert/strict');
const {evaluateCore,policy}=require('../src/oralExam/grading');
const {allowed,classifyNext}=require('../src/oralExam/progression');
const conversation=require('../src/oralExam/conversation');
const scored=value=>({understanding:value,accuracy:value,completeness:value,communication:value,feedback:'Assessment',strengths:[],improvements:[]});
const turn=(sequence,value,kind='core',concept='Routing')=>({sequence,concept,category:kind,concept_key:concept.toLowerCase(),question_type:kind==='core'?'initial':kind,transcript:'Saved answer',assessment:scored(value)});
const exam=turns=>({status:'completed',termination_reason:'exam_completed',language:'en',context:{oral_policy:policy()},turns});
test('initial 60 and follow-up 90 produce a concept result of 72; multiple follow-ups share 40%',()=>{
  const s=exam([turn(1,60),turn(2,90,'follow_up')]);
  assert.equal(evaluateCore(s).core_score,72);
  s.turns.push(turn(3,70,'follow_up'));
  assert.equal(evaluateCore(s).core_score,68);
  assert.equal(evaluateCore(s).completed_core_concepts,1);
  assert.equal(evaluateCore(s).follow_up_questions,2);
});
test('five distinct core concepts have equal weight regardless of follow-up count',()=>{
  const s=exam(Array.from({length:5},(_,i)=>turn(i+1,80,'core','Concept '+i)));
  s.turns.push(turn(6,100,'follow_up','Concept 0'),turn(7,100,'follow_up','Concept 0'));
  const r=evaluateCore(s);assert.equal(r.required_concepts,5);assert.equal(r.completed_core_concepts,5);
  assert.equal(r.core_score,82);assert.equal(r.follow_up_questions,2);assert.equal(r.incomplete_coverage,false);
  assert.deepEqual(evaluateCore(s),r);
});
test('bonus never reduces core or prior bonus credit; +4 and capped +5 examples',()=>{
  for(const [core,bonus,addition,final] of [[78,20,0,78],[78,92,4,82],[98,100,5,100]]){
    const s=exam(Array.from({length:5},(_,i)=>turn(i+1,core,'core','Concept '+i)));
    s.turns.push(turn(6,bonus,'bonus','Application'));
    let r=evaluateCore(s);assert.equal(r.core_score,core);assert.equal(r.bonus_score,addition);assert.equal(r.score,final);
    s.turns.push(turn(7,0,'bonus','Harder application'));r=evaluateCore(s);assert.equal(r.score,final);
  }
});
test('untested, unanswered and invalid assessments do not invent marks or inflate coverage',()=>{
  const s=exam([turn(1,80),{...turn(2,80,'core','Switching'),assessment:null},{...turn(3,100,'bonus'),transcript:null}]);
  for(const reason of ['student_ended','time_limit','provider_failure']){
    s.termination_reason=reason;s.technical_interruptions=[{kind:'provider_failure'}];
    const r=evaluateCore(s);assert.equal(r.core_score,80);assert.equal(r.completed_core_concepts,1);assert.equal(r.bonus_score,0);
    assert.equal(r.unassessed_answers,1);assert.equal(r.technical_interruptions,1);assert.equal(r.termination_reason,reason);
  }
  assert.equal(evaluateCore(exam([])).score,null);
});
test('legacy follow-ups belong to their preceding core even if a model used a different label',()=>{
  const s=exam([{...turn(1,60),category:null,concept_key:null},{...turn(2,90,'follow_up','Other label'),category:null,concept_key:null}]);
  assert.equal(evaluateCore(s).core_score,72);assert.equal(evaluateCore(s).completed_core_concepts,1);
});
test('backend enforces final minute, final 30 seconds, close threshold and follow-up limit',()=>{
  const s=exam([turn(1,80)]),q={question:'Another question?',concept:'New concept',question_type:'next_topic'};
  assert.equal(allowed(s,61).core,true);
  for(const seconds of [60,30,16]){assert.equal(allowed(s,seconds).phase,'final');assert.equal(classifyNext(s,q,seconds),null);assert.equal(classifyNext(s,{...q,question_type:'follow_up'},seconds).concept,'Routing');}
  for(const seconds of [15,0])assert.equal(classifyNext(s,{...q,question_type:'follow_up'},seconds),null);
  s.turns.push(turn(2,80,'follow_up'),turn(3,80,'follow_up'));
  assert.equal(classifyNext(s,{...q,question_type:'follow_up'},200),null);
  assert.equal(classifyNext(s,{...q,concept:'Routing'},200),null);
});
test('bonus is enabled only after required cores, plan names constrain new concepts',()=>{
  const s=exam([turn(1,80)]),q={concept:'Application',question_type:'bonus'};
  assert.equal(classifyNext(s,q,100),null);
  s.context.core_plan=[{name:'Routing'}];assert.equal(classifyNext(s,q,100).category,'bonus');
  s.context.core_plan.push({name:'Switching'});
  assert.equal(classifyNext(s,{concept:'Unknown',question_type:'next_topic'},100),null);
  assert.equal(classifyNext(s,{concept:'Switching',question_type:'next_topic'},100).category,'core');
});
test('transitions reject answer leakage, scores, grading, explanations and language mismatch',()=>{
  const evidence=[{text:'A router consults its routing table to select the next hop.'}];
  for(const text of ['Your score is 90.','The correct answer is a routing table.','It consults its routing table.','Because routers forward packets.','Good? Try again.'])assert.equal(conversation.safeTransition(text,evidence,'What does a router do?','en'),false);
  assert.equal(conversation.safeTransition('You identified the main idea clearly.',evidence,'','en'),true);
  assert.equal(conversation.safeTransition('خلينا نكمل من زاوية ثانية.',evidence,'','ar'),true);
  assert.equal(conversation.safeTransition('Good work.',evidence,'','ar'),false);
  assert.match(conversation.closing('ar'),/نهاية/);assert.match(conversation.closing('en'),/end/);
});
