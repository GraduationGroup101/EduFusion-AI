const {conceptKey,classified,policy}=require('./grading');
function remaining(session,now=Date.now()){return Math.max(0,(new Date(session.expires_at)-now)/1000);}
function allowed(session,seconds=remaining(session)){
  const turns=classified(session.turns||[]),current=turns.at(-1),rules=session.context?.oral_policy||policy();
  const covered=new Set(turns.filter(t=>t.category==='core').map(t=>t.concept_key));
  const required=session.context?.core_plan?.length||rules.required_concepts;
  const followCount=current?turns.filter(t=>t.category==='follow_up'&&t.concept_key===current.concept_key).length:0;
  return {remaining_seconds:seconds,phase:seconds<=15?'closing':seconds<=60?'final':'examining',
    core:seconds>60&&covered.size<required,follow_up:seconds>15&&current&&current.category!=='bonus'&&followCount<rules.max_follow_ups,
    bonus:seconds>60&&covered.size>=required,covered:[...covered],required};
}
// Applied again inside the fenced transaction, using database time. The model
// proposes questions; it cannot change categories, coverage or time policy.
function classifyNext(session,proposal,seconds=remaining(session)){
  if(!proposal)return null;
  const a=allowed(session,seconds),turns=classified(session.turns||[]),current=turns.at(-1);
  const key=conceptKey(proposal.concept);
  if(a.phase==='closing')return null;
  if(proposal.question_type==='follow_up'){
    if(!a.follow_up)return null;
    return {...proposal,concept:current.concept,concept_key:current.concept_key,category:'follow_up',parent_sequence:current.category==='core'?current.sequence:current.parent_sequence};
  }
  if(proposal.question_type==='bonus'){
    if(!a.bonus)return null;
    return {...proposal,concept_key:key,category:'bonus',parent_sequence:null};
  }
  if(!a.core||a.covered.includes(key))return null;
  const plan=session.context?.core_plan;
  if(plan?.length&&!plan.some(c=>conceptKey(c.name)===key))return null;
  return {...proposal,question_type:turns.length?'next_topic':'initial',concept_key:key,category:'core',parent_sequence:null};
}
module.exports={remaining,allowed,classifyNext};
