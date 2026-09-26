const express=require('express');
const {authenticate,requireRole}=require('../middleware/auth');
const {aiLimiter}=require('../middleware/limits');
const {integer,text,choice}=require('../lib/validation');
const {requestUpstream,readJson,upstreamStatus,sendError}=require('../lib/upstream');
const {readQuery}=require('../db');
const {changeClock}=require('../db/clocks');
const {getCurrentAtRiskStudents,getLatestPredictionRiskCounts}=require('../db/queries');
const router=express.Router();
const BASE=(process.env.EDUPREDICT_API_URL || 'https://edupredict-api-6ob5.onrender.com').replace(/\/+$/,'');
router.use(authenticate,requireRole(['admin','advisor']));
const runBatch=async(req,limit)=>{
  limit=integer(limit ?? 150,'Prediction limit',1,1000);
  if(!process.env.ADMIN_API_KEY) throw new Error('Admin service is not configured');
  const response=await requestUpstream(req,`${BASE}/admin/predictions/run-demo?limit=${limit}`,{method:'POST',headers:{'X-Admin-Key':process.env.ADMIN_API_KEY}});
  const data=await readJson(response);
  if(!response.ok) throw Object.assign(new Error('Prediction regeneration failed'),{statusCode:upstreamStatus(response.status)});
  return data;
};
router.get('/students/at-risk',async(req,res)=>{
 try {
  const students=await getCurrentAtRiskStudents({
    riskLevel:req.query.risk_level===undefined?undefined:choice(req.query.risk_level,'Risk level',['LOW','MEDIUM','HIGH']),
    atRisk:req.query.at_risk===undefined?undefined:choice(req.query.at_risk,'At-risk filter',['true','false']),
    limit:integer(req.query.limit ?? 50,'Limit',1,1000)});
  res.json({students});
 }catch(error){sendError(res,error,'Unable to load students');}
});
router.get('/predictions/risk-counts',async(req,res)=>{
 try{res.json(await getLatestPredictionRiskCounts());}catch(error){sendError(res,error);}
});
router.post('/predictions/run-demo',aiLimiter,async(req,res)=>{
 try{res.json(await runBatch(req,req.query.limit ?? req.body?.limit));}catch(error){sendError(res,error,'Unable to run predictions');}
});
router.get('/students/:id_student/prediction',aiLimiter,async(req,res)=>{
 try{
  const id=integer(req.params.id_student,'Student ID',1);
  const params=new URLSearchParams();
  for(const key of ['code_module','code_presentation']) if(req.query[key]!==undefined)params.set(key,text(req.query[key],key,{max:20}));
  const response=await requestUpstream(req,`${BASE}/students/${id}/prediction?${params}`);
  res.status(upstreamStatus(response.status)).json(await readJson(response));
 }catch(error){sendError(res,error,'Unable to load prediction');}
});
router.get('/clock',async(req,res)=>{
 try{
  const clocks=await readQuery('SELECT ac.*,cp.code_module,cp.code_presentation FROM academic_clocks ac JOIN course_presentations cp ON cp.id=ac.course_presentation_id ORDER BY cp.code_module,cp.code_presentation');
  res.json({clocks:clocks.rows});
 }catch(error){sendError(res,error,'Unable to load academic clocks');}
});
const clockHandler=(reset,all)=>async(req,res)=>{
 try{
  const limit=integer(req.body?.limit ?? 150,'Prediction limit',1,1000);
  const command=reset?{day:integer(req.body?.day ?? 60,'Day',0,1000)}:{tickDays:integer(req.body?.days ?? 1,'Days',1,365)};
  if(!all){command.module=text(req.body?.code_module,'Module',{max:20});command.presentation=text(req.body?.code_presentation,'Presentation',{max:20});}
  const result=await changeClock(req.user,req.get('Idempotency-Key'),command);
  let predictions=null;const warnings=[];
  if(!result.replayed){try{predictions=await runBatch(req,limit);}catch{warnings.push('Clock updated. Prediction regeneration is temporarily unavailable; run predictions again.');}}
  res.json({...result,predictions,warnings});
 }catch(error){sendError(res,error,'Unable to update academic clocks');}
};
router.post('/clock/tick-all',aiLimiter,clockHandler(false,true));
router.post('/clock/reset-all',aiLimiter,clockHandler(true,true));
router.post('/clock/tick',aiLimiter,clockHandler(false,false));
router.post('/clock/reset',aiLimiter,clockHandler(true,false));
module.exports=router;
