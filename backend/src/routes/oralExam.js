const express=require('express');
const {authenticate}=require('../middleware/auth');
const {aiLimiter}=require('../middleware/limits');
const {createInput,id,fail}=require('../oralExam/contracts');
const {configured}=require('../oralExam/config');
const {resolveMaterial}=require('../oralExam/material');
const store=require('../oralExam/store');
const examiner=require('../oralExam/examiner');
const study=require('../lectureStudy/store');
const learning=require('../lectureStudy/database');
const legacy=require('../db/appStore');
const router=express.Router();
const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){
  const status=error.name==='ZodError'?400:error.statusCode||503;
  if(status>=500)console.error('Oral exam request failed:',error.code||error.name);
  res.status(status).json({error:status===400?'Check your material and exam settings':status<500?error.message:'Oral Exam is temporarily unavailable. Please try again.'});
}};
router.use(authenticate);
router.get('/status',(_req,res)=>res.json({enabled:configured(),max_duration_seconds:600}));
router.use((_req,res,next)=>configured()?next():res.status(503).json({error:'Oral Exam is not enabled yet'}));
router.get('/materials',wrap(async(req,res)=>{
  const jobs=await legacy.listJobs(req.user);
  let lectures=[],libraryUnavailable=false;
  if(learning.enabled())try{
    lectures=await study.listLectures(req.user,0);
    if(req.query.lecture&&!lectures.some(l=>l.id===req.query.lecture))lectures.push(await study.getLecture(req.user,id.parse(req.query.lecture)));
  }catch{libraryUnavailable=true;}
  res.json({materials:[...lectures.filter(l=>l.status==='ready').map(l=>({kind:'lecture',id:l.id,title:l.title})),
    ...jobs.filter(j=>j.status==='completed').map(j=>({kind:'transcript',id:j.job_id,title:j.title||j.request?.youtube_url||'Lecture transcript'}))],library_unavailable:libraryUnavailable});
}));
router.get('/sessions',wrap(async(req,res)=>res.json({sessions:await store.list(req.user)})));
router.post('/sessions',aiLimiter,wrap(async(req,res)=>{
  const input=createInput.parse(req.body),key=req.get('Idempotency-Key');
  if(!key||!/^[\w-]{8,100}$/.test(key))fail(400,'A valid request key is required');
  const material=await resolveMaterial(req.user,input.source);
  res.status(201).json({session:store.publicView(await store.create(req.user,material,input.language,key))});
}));
router.get('/sessions/:id',wrap(async(req,res)=>{
  const session=await store.get(req.user,id.parse(req.params.id));
  res.json({session:store.publicView(session)});
}));
router.post('/sessions/:id/start',aiLimiter,wrap(async(req,res)=>{
  await store.start(req.user,id.parse(req.params.id));
  res.json({session:store.publicView(await store.get(req.user,req.params.id))});
}));
router.post('/sessions/:id/end',wrap(async(req,res)=>{
  await store.finish(req.user,id.parse(req.params.id));
  const evaluation=await examiner.evaluate(req.user,req.params.id);
  res.json({session:store.publicView(await store.get(req.user,req.params.id)),evaluation});
}));
// Retrying feedback is idempotent: a ready report is returned as-is, a
// concurrent attempt is shared, and a failed attempt reports a safe reason
// while the saved answers stay untouched.
router.post('/sessions/:id/evaluation',aiLimiter,wrap(async(req,res)=>{
  const session=await store.get(req.user,id.parse(req.params.id));
  if(['ready','active'].includes(session.status))fail(409,'End the exam before requesting feedback');
  const evaluation=await examiner.evaluate(req.user,req.params.id);
  res.json({session:store.publicView(await store.get(req.user,req.params.id)),evaluation});
}));
module.exports=router;
