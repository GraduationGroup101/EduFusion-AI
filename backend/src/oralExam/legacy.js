const {z}=require('zod');
const {evaluation}=require('./contracts');

// A saved core report or either policy marker identifies the new system.
// Never infer that policy from historical question sequences or today's config.
const isLegacy=session=>!session.core_evaluation&&!session.context?.oral_policy&&!session.context?.core_plan;
const historicalEvaluation=evaluation.extend({score:z.number().min(0).max(100)}).passthrough();
const fields=['score','understanding','accuracy','completeness','communication','strengths','areasForImprovement','topicsCovered','summary'];
function report(session){
  if(historicalEvaluation.safeParse(session.evaluation).success){
    // Validate without transforming saved text/dimensions or leaking new fields.
    return {...Object.fromEntries(fields.map(key=>[key,session.evaluation[key]])),version:0,legacy:true};
  }
  return {version:0,legacy:true,unscored:true,score:null,understanding:null,accuracy:null,completeness:null,communication:null,
    strengths:[],areasForImprovement:[],topicsCovered:[],
    summary:session.language==='ar'?'لم يُحفظ تقييم مكتمل لهذه المقابلة السابقة. الإجابات المحفوظة متاحة للمراجعة، ولا تُطبّق عليها قواعد التقييم الجديدة.':'No complete evaluation was saved for this historical exam. Saved answers remain available for review; the new grading rules have not been applied.'};
}
module.exports={isLegacy,report};
