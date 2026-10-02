const {assessment}=require('./contracts');
const {normalize}=require('./conversation');
const DIMENSIONS={understanding:.35,accuracy:.35,completeness:.2,communication:.1};
const round=n=>Math.round(n*10)/10;
const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
const weighted=value=>Object.entries(DIMENSIONS).reduce((sum,[key,weight])=>sum+value[key]*weight,0);
const policy=()=>({version:1,required_concepts:Math.min(8,Math.max(1,Number.parseInt(process.env.ORAL_EXAM_CORE_CONCEPTS||'5',10)||5)),max_follow_ups:2,max_bonus:5});
const conceptKey=value=>normalize(value);
function classified(turns){
  let core=null;
  return turns.map(turn=>{
    const category=turn.category||(turn.question_type==='bonus'?'bonus':turn.question_type==='follow_up'?'follow_up':'core');
    if(category==='core')core=turn;
    return {...turn,category,concept_key:turn.concept_key||(category==='follow_up'&&core?conceptKey(core.concept):conceptKey(turn.concept)),parent_sequence:turn.parent_sequence||(category==='follow_up'?core?.sequence:null)};
  });
}
function evaluateCore(session){
  const turns=classified(session.turns||[]),rules=session.context?.oral_policy||policy();
  const grounding=require('./grounding');
  const answered=turns.filter(t=>t.transcript);
  const valid=answered.filter(t=>{
    if(!grounding.enabled(session))return assessment.safeParse(t.assessment).success;
    try{grounding.storedAssessment(t.assessment,t,session.context.chunks.filter(c=>t.citations.includes(c.id)),t.transcript,session.language);return true;}catch{return false;}
  });
  const groups=new Map();
  for(const t of valid.filter(t=>t.category!=='bonus')){
    if(!groups.has(t.concept_key))groups.set(t.concept_key,[]);
    groups.get(t.concept_key).push(t);
  }
  const concepts=[];
  for(const [id,answers] of groups){
    const initial=answers.find(t=>t.category==='core');
    if(!initial)continue; // A missing initial assessment is not fabricated.
    const follows=answers.filter(t=>t.category==='follow_up');
    const dimensions=Object.fromEntries(Object.keys(DIMENSIONS).map(key=>[key,follows.length?initial.assessment[key]*.6+mean(follows.map(t=>t.assessment[key]))*.4:initial.assessment[key]]));
    concepts.push({id,name:initial.concept,...Object.fromEntries(Object.entries(dimensions).map(([k,v])=>[k,round(v)])),score:round(weighted(dimensions)),follow_ups:follows.length});
  }
  const dimensions=Object.fromEntries(Object.keys(DIMENSIONS).map(key=>[key,concepts.length?round(mean(concepts.map(c=>c[key]))):null]));
  const coreScore=concepts.length?Math.round(mean(concepts.map(c=>c.score))):null;
  const required=session.context?.core_plan?.length||rules.required_concepts;
  const bonuses=valid.filter(t=>t.category==='bonus');
  // Best completed bonus only: an extra weak bonus cannot reduce earned credit.
  const best=bonuses.length?Math.max(...bonuses.map(t=>weighted(t.assessment))):0;
  const bonus=concepts.length>=required?round(Math.min(5,rules.max_bonus)*Math.max(0,(best-60)/40)):0;
  const unique=items=>[...new Set(items)].slice(0,12);
  const unassessed=answered.length-valid.length;
  return {version:1,...dimensions,weights:DIMENSIONS,core_score:coreScore,bonus_score:bonus,score:coreScore===null?null:Math.min(100,round(coreScore+bonus)),
    required_concepts:required,requested_concepts:rules.required_concepts,completed_core_concepts:concepts.length,concepts,
    follow_up_questions:turns.filter(t=>t.category==='follow_up').length,bonus_questions:turns.filter(t=>t.category==='bonus').length,
    assessed_answers:valid.length,unassessed_answers:unassessed,incomplete_coverage:concepts.length<required,
    termination_reason:session.termination_reason||session.status,technical_interruptions:(session.technical_interruptions||[]).length,
    strengths:unique(valid.flatMap(t=>t.assessment.strengths)),areasForImprovement:unique(valid.flatMap(t=>t.assessment.improvements)),topicsCovered:unique(concepts.map(c=>c.name).concat(bonuses.map(t=>t.concept))),
    summary:session.language==='ar'?'يستند هذا التقييم إلى الإجابات المكتملة والمقيّمة فقط.':'This evaluation is based only on completed, assessed answers.'};
}
module.exports={DIMENSIONS,policy,conceptKey,classified,evaluateCore};
