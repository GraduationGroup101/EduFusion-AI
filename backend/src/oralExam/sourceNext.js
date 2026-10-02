const grounding=require('./grounding');
const {conceptKey}=require('./grading');

// A bounded fallback uses plan labels and complete saved source units only.
// The caller still applies every normal rubric/grounding/progression check.
function sourceNext(session,target,bonus=false){
  const criteria=grounding.catalog(session.context.chunks),plan=session.context.core_plan||[];
  const matching=topic=>{
    const name=topic.name.toLowerCase(),matches=criteria.filter(c=>c.criterion.toLowerCase().includes(name));
    // Prefer the topic's own source heading/opening, not another topic that
    // merely mentions it (for example DHCP supplying a DNS server).
    const primary=matches.filter(c=>c.criterion.toLowerCase().startsWith(name+':')||c.criterion.toLowerCase().startsWith(name+' '));
    return (primary.length?primary:matches).slice(0,1);
  };
  const options=bonus?plan.flatMap((left,i)=>plan.slice(i+1).map(right=>({topics:[left,right],question:session.language==='ar'?`قارن ${left.name} و ${right.name}.`:`Compare ${left.name} and ${right.name}.`})))
    :target?[{topics:[target],question:session.language==='ar'?`اشرح ${target.name}.`:`Explain ${target.name}.`}]:[];
  for(const option of options){
    if(session.turns.some(t=>t.question===option.question))continue;
    const groups=option.topics.map(matching);if(groups.some(c=>!c.length))continue;
    const selected=[...new Map(groups.flat().map(c=>[c.id,c])).values()].slice(0,5);
    if(groups.some(group=>!group.some(c=>selected.some(s=>s.id===c.id))))continue;
    const next={question:option.question,concept:option.topics.map(t=>t.name).join(' / '),question_type:bonus?'bonus':'next_topic',difficulty:bonus?'analysis':'foundation',citations:[...new Set(selected.flatMap(c=>c.citations))],criterion_ids:selected.map(c=>c.id),follow_up_reason:''};
    try{
      grounding.nextDecision.parse({next});
      if(!bonus&&conceptKey(next.concept)!==conceptKey(target.name))continue;
      grounding.rubric(next,session.context.chunks);return next;
    }catch { /* No safe source-derived option: close rather than invent one. */ }
  }
  return null;
}
module.exports={sourceNext};
