const {z}=require('zod');
const {isDeepStrictEqual}=require('node:util');
const {question,providerSchema}=require('./contracts');
class GroundingError extends Error {constructor(code){super('Invalid grounded decision');this.name='ModelValidationError';this.code=code;}}
const reject=code=>{throw new GroundingError(code);};
const normalize=s=>String(s||'').normalize('NFKC').replace(/[\u064B-\u065F\u0670]/g,'').toLowerCase();
const stem=s=>/^[a-z]+$/.test(s)?s.replace(/s$/,'').replace(/(ing|er|ed|es)$/,''):s.replace(/^(وال|بال|لل|ال|و)/,'');
const words=s=>(normalize(s).match(/[\p{L}\p{N}]+/gu)||[]).map(stem);
// Only linguistic/question scaffolding is exempt. Academic nouns must occur
// in the selected source criteria, including when the exam language differs.
const scaffold=new Set(words('a an the and or but if when why how what which who where does do is are was were be been being can could would should will may might must to of for from in on at by with without as than then that this these those it its they their you your we our i explain describe compare contrast discuss identify choose consider imagine suppose scenario situation example use using used role purpose main important characteristics characteristic differences difference relationship relationships work works working affect affects impact effect effects happen happens need needs necessary given following based according show tell include including briefly clearly detail details more less most least both each between same different possible suitable suitability justify reason reasons reasoning step steps take takes function functions perform performance design designing application applications apply applied operation operating operate behavior behaviour result results address answer question concept concepts point points provide provides about also so not no yes under over up down other another now instead especially better best only one two three four five first second third next current previous understand understanding complete completeness accurate accuracy communicate communication clear clarity foundational foundation fundamental fundamentals analysis challenge real time real-time system systems process processes response responses correctly correct partial missing incorrect مش اشرح وضح قارن صف ما ماذا لماذا كيف اي أي هل من في على الى إلى عن مع دون بين اذا إذا عندما ان أن او أو و هذا هذه ذلك تلك هو هي هم انت أنت كل بعض اكثر أكثر اقل أقل مثال حالة سيناريو اختر ناقش اذكر دور وظيفة استخدام يستخدم يمكن ينبغي يجب بناء اساس أساس علاقة اختلاف نتيجة سبب خطوة مفهوم نقطة سؤال اجابة إجابة بشكل واضح باختصار نفس مختلف فقط'));
function catalog(evidence){return evidence.flatMap(c=>String(c.text).split(/(?<=[.!?؟])\s+|\n+/u).map(s=>s.trim()).filter(s=>s.length>=8&&s.length<=1800).map((criterion,i)=>({id:`${c.id}:${i}`,criterion,citations:[c.id]})));}
function lexical(text,criteria){const allowed=new Set(criteria.flatMap(c=>words(c.criterion)));if(words(text).some(w=>!scaffold.has(w)&&!allowed.has(w)))reject('unsupported_question_term');}
const rating=z.enum(['met','partial','missing','incorrect']);
const verdict=z.object({criterion_id:z.string().min(1).max(100),level:rating,answer_quote:z.string().max(800)}).strict();
const groundedAssessment=z.object({grounding:z.object({citations:z.array(z.string()).min(1).max(6),criteria:z.array(verdict).min(1).max(5)}).strict(),communication:z.enum(['clear','unclear'])}).strict();
const groundedQuestion=question.extend({criterion_ids:z.array(z.string().min(1).max(100)).min(1).max(5)});
const {decision,commentary}=require('./contracts');
const groundedDecision=decision.extend({assessment:groundedAssessment.nullable(),next:groundedQuestion.nullable()});
const groundedCommentary=z.object({summary:z.enum(['completed','practice','limited']),strength_ids:z.array(z.number().int().min(0)).max(8),improvement_ids:z.array(z.number().int().min(0)).max(8)}).strict();
const enabled=s=>s.context?.grounding_version===1;
function validatePlan(plan,evidence,max){if(!Array.isArray(plan)||!plan.length||plan.length>max)reject('invalid_core_plan');for(const c of plan){if(!c.citations?.length||c.citations.some(id=>!evidence.some(e=>e.id===id)))reject('invalid_core_plan');lexical(c.name,catalog(evidence.filter(e=>c.citations.includes(e.id))));}return plan;}
const evidenceFor=s=>{const cited=new Set(s.turns.at(-1)?.citations||[]);return s.context.chunks.filter(c=>cited.has(c.id)).map(({id,section,text})=>({id,section,text}));};
function rubric(proposal,generationEvidence,current=null,assessment=null){
  const all=catalog(generationEvidence),ids=proposal.criterion_ids;
  if(!Array.isArray(ids)||ids.length<1||ids.length>5||new Set(ids).size!==ids.length)reject('invalid_rubric');
  const selected=ids.map(id=>all.find(c=>c.id===id));
  if(selected.some(c=>!c)||selected.some(c=>!proposal.citations.includes(c.citations[0]))||proposal.citations.some(id=>!selected.some(c=>c.citations.includes(id))))reject('unsupported_rubric');
  lexical(proposal.question,selected);lexical(proposal.concept,selected);
  if(proposal.question_type==='follow_up'){
    const missing=new Set(assessment?.grounding.criteria.filter(c=>c.level!=='met').map(c=>c.criterion_id)||[]);
    if(!current?.grading_criteria||selected.some(c=>!missing.has(c.id)||!current.grading_criteria.some(p=>p.id===c.id&&p.criterion===c.criterion)))reject('unsupported_follow_up');
  }
  const {criterion_ids,...q}=proposal;return {...q,grading_criteria:selected};
}
const labels=ar=>ar?{strength:'تناولت هذه النقطة: ',improvement:'راجع هذه النقطة من المادة: ',feedback:'التقييم مبني فقط على نقاط السؤال المدعومة بالمادة.'}:{strength:'You addressed this source point: ',improvement:'Review this source point: ',feedback:'Assessment uses only the source-supported points for this question.'};
function assess(value,current,evidence,transcript,language){
  value=groundedAssessment.parse(value);
  const criteria=current?.grading_criteria;if(!criteria?.length)reject('missing_saved_rubric');
  const allowed=new Set(evidence.map(c=>c.id)),refs=value.grounding.criteria;
  if(value.grounding.citations.some(id=>!allowed.has(id))||new Set(refs.map(c=>c.criterion_id)).size!==criteria.length||refs.length!==criteria.length)reject('assessment_evidence_scope');
  for(const c of refs){const saved=criteria.find(p=>p.id===c.criterion_id);if(!saved||saved.citations.some(id=>!value.grounding.citations.includes(id)))reject('assessment_criterion_scope');
    if(c.level==='missing'&&c.answer_quote||c.level!=='missing'&&(!c.answer_quote.trim()||!normalize(transcript).includes(normalize(c.answer_quote))))reject('unsupported_answer_quote');}
  const score=Math.round(refs.reduce((sum,c)=>sum+({met:100,partial:60,missing:0,incorrect:0}[c.level]),0)/refs.length),l=labels(language==='ar');
  const texts=level=>refs.filter(level).map(c=>criteria.find(p=>p.id===c.criterion_id).criterion);
  return {understanding:score,accuracy:score,completeness:score,communication:value.communication==='clear'?100:70,feedback:l.feedback,
    strengths:texts(c=>c.level==='met').map(s=>l.strength+s),improvements:texts(c=>c.level!=='met').map(s=>l.improvement+s),
    grounding:{version:1,citations:value.grounding.citations,criteria:refs,communication:value.communication}};
}
function storedAssessment(a,current,evidence,transcript,language){
  if(a?.grounding?.version!==1)reject('ungrounded_assessment');
  const rebuilt=assess({grounding:{citations:a.grounding.citations,criteria:a.grounding.criteria},communication:a.grounding.communication},current,evidence,transcript,language);
  if(!isDeepStrictEqual(rebuilt,a))reject('altered_grounded_assessment');return rebuilt;
}
function storedRubric(q,evidence){const rebuilt=rubric({...q,question_type:'initial',criterion_ids:q.grading_criteria?.map(c=>c.id)},evidence);if(!isDeepStrictEqual(rebuilt.grading_criteria,q.grading_criteria))reject('altered_rubric');return q;}
function finalCommentary(value,core,language){
  if(value.strength_ids.some(i=>i>=core.strengths.length)||value.improvement_ids.some(i=>i>=core.areasForImprovement.length))reject('unsupported_commentary_reference');
  const summaries=language==='ar'?{completed:'أكملت التقييم. يعرض هذا التقرير النقاط التي تم اختبارها من مادتك فقط.',practice:'استخدم النقاط المدعومة بالمادة أدناه لمواصلة التدريب.',limited:'يعتمد التقرير على الإجابات المكتملة والمقيّمة فقط.'}:{completed:'You completed the assessment. This report covers only the source points tested.',practice:'Use the source-supported points below to continue practising.',limited:'This report uses completed, assessed answers only.'};
  return {summary:summaries[value.summary],strengths:value.strength_ids.map(i=>core.strengths[i]),areasForImprovement:value.improvement_ids.map(i=>core.areasForImprovement[i])};
}
module.exports={enabled,validatePlan,catalog,lexical,evidenceFor,rubric,assess,storedAssessment,storedRubric,finalCommentary,groundedDecision,groundedCommentary,decisionSchema:providerSchema(groundedDecision),commentarySchema:providerSchema(groundedCommentary)};
