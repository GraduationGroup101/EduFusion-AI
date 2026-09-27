const express = require('express');
const { authenticate } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/limits');
const { text, integer, object } = require('../lib/validation');
const { readQuery } = require('../db');
const { getCurrentStudentPrediction } = require('../db/queries');
const legacy = require('../db/appStore');
const { requestUpstream } = require('../lib/upstream');
const db = require('../lectureStudy/database');
const store = require('../lectureStudy/store');
const validate = require('../lectureStudy/validation');
const router = express.Router();
router.use(authenticate);
const wrap = (work) => async (req,res) => {
  try { await work(req,res); }
  catch (error) {
    const status = error.statusCode || 503;
    if (status >= 500) console.error('Lecture study request failed:', error.code || error.name);
    if (status === 429) res.set('Retry-After','60');
    res.status(status).json({ error: status < 500 ? error.message : 'Lecture study is temporarily unavailable. Your other tools remain available.' });
  }
};
const jobView = ({ id,lecture_id,kind,status,stage,result,error,created_at,updated_at }) =>
  ({ id,lecture_id,kind,status,stage,result,error,created_at,updated_at });
const enrollment = async (user,id) => {
  if (id == null) return null;
  if (user.role !== 'student') throw Object.assign(new Error('Only your registered courses can be linked'),{statusCode:403});
  const row = (await readQuery(
    'SELECT e.id,cp.code_module,cp.code_presentation FROM enrollments e JOIN course_presentations cp ON cp.id=e.course_presentation_id WHERE e.id=$1 AND e.id_student=$2', [id,user.id_student])).rows[0];
  if (!row) throw Object.assign(new Error('Enrollment not found'),{statusCode:404});
  return row;
};
router.get('/status',wrap(async (_req,res) => {
  if (!db.enabled() || !process.env.LEARNING_DATABASE_URL) return res.json({enabled:false,worker_online:false});
  res.json(await store.status());
}));
router.use((_req,res,next) => {
  if (!db.enabled() || !process.env.LEARNING_DATABASE_URL) return res.status(503).json({error:'Lecture study has not been enabled yet'});
  return next();
});
router.get('/lectures',wrap(async (req,res) => {
  const offset = integer(req.query.offset ?? 0,'Offset',0,100000);
  res.json({lectures:await store.listLectures(req.user,offset),offset});
}));
router.post('/lectures',aiLimiter,wrap(async (req,res) => {
  const source = validate.source(req.body);
  await enrollment(req.user,source.enrollment_id);
  const result = await store.createLecture(req.user,source,validate.requestKey(req));
  res.status(result.lecture.status === 'ready' ? 200 : 202).json({...result,job:jobView(result.job)});
}));
router.post('/import',aiLimiter,wrap(async (req,res) => {
  object(req.body);
  const jobId = text(req.body.job_id,'Job ID',{max:200});
  const key = validate.requestKey(req);
  if (!await legacy.ownsJob(req.user,jobId)) return res.status(404).json({error:'Job not found'});
  const job = (await legacy.listJobs(req.user)).find((job) => job.job_id === jobId);
  if (!job?.request?.youtube_url) return res.status(409).json({error:'This job has no saved source; add its YouTube URL again'});
  const source = validate.source({...job.request,enrollment_id:req.body.enrollment_id});
  await enrollment(req.user,source.enrollment_id);
  const previous=await store.preparationReplay(req.user,source,key);
  if(previous)return res.status(previous.lecture.status==='ready'?200:202).json({...previous,job:jobView(previous.job)});
  // Never accept transcript text or a provider URL supplied by the browser.
  const base = String(process.env.LECTURESCRIBE_API_URL || 'https://lecturescribe.app').replace(/\/+$/,'');
  const statusResponse = await requestUpstream(req,base + '/jobs/' + encodeURIComponent(jobId),{}, {timeoutMs:30000});
  if (!statusResponse.ok || (await statusResponse.json()).status !== 'completed') return res.status(409).json({error:'The original transcript is not ready or its service is offline'});
  let response = await requestUpstream(req,base + '/jobs/' + encodeURIComponent(jobId) + '/transcript?kind=cleaned',{}, {timeoutMs:30000,maxBytes:1024*1024});
  if (!response.ok) response = await requestUpstream(req,base + '/jobs/' + encodeURIComponent(jobId) + '/transcript?kind=raw',{}, {timeoutMs:30000,maxBytes:1024*1024});
  if (!response.ok) throw new Error('Transcript download failed');
  const transcript = text(await response.text(),'Transcript',{max:1024*1024});
  const result = await store.createLecture(req.user,source,key,{transcript});
  res.status(result.lecture.status === 'ready' ? 200 : 202).json({...result,job:jobView(result.job)});
}));
router.get('/lectures/:id',wrap(async (req,res) => res.json({lecture:await store.getLecture(req.user,validate.id(req.params.id))})));
router.delete('/lectures/:id',wrap(async (req,res) => {
  await store.removeLecture(req.user,validate.id(req.params.id)); res.json({success:true});
}));
router.get('/lectures/:id/messages',wrap(async (req,res) => res.json({messages:await store.messages(req.user,validate.id(req.params.id))})));
router.post('/lectures/:id/messages',aiLimiter,wrap(async (req,res) => {
  object(req.body);
  const payload = {question:text(req.body.question,'Question',{max:2000})};
  const job = await store.enqueue(req.user,validate.id(req.params.id),'chat',validate.requestKey(req),payload);
  res.status(job.status === 'completed' ? 200 : 202).json({job:jobView(job)});
}));
router.delete('/lectures/:id/messages',wrap(async (req,res) => {
  await store.clearMessages(req.user,validate.id(req.params.id));
  res.json({success:true});
}));
router.get('/lectures/:id/quizzes',wrap(async (req,res) => res.json({quizzes:await store.quizzes(req.user,validate.id(req.params.id))})));
router.post('/lectures/:id/quizzes',aiLimiter,wrap(async (req,res) => {
  const job = await store.enqueue(req.user,validate.id(req.params.id),'quiz',validate.requestKey(req),validate.counts(req.body));
  res.status(job.status === 'completed' ? 200 : 202).json({job:jobView(job)});
}));
router.get('/quizzes/:id',wrap(async (req,res) => res.json({quiz:validate.publicQuiz(await store.getQuiz(req.user,validate.id(req.params.id)))})));
router.post('/quizzes/:id/attempts',wrap(async (req,res) => {
  object(req.body);
  res.json({attempt:await store.submitAttempt(req.user,validate.id(req.params.id),validate.requestKey(req),object(req.body.answers))});
}));
router.get('/lectures/:id/attempts',wrap(async (req,res) => res.json({attempts:await store.attempts(req.user,validate.id(req.params.id))})));
router.get('/jobs/:id',wrap(async (req,res) => res.json({job:jobView(await store.getJob(req.user,validate.id(req.params.id)))})));
router.post('/jobs/:id/retry',aiLimiter,wrap(async (req,res) => res.status(202).json({job:await store.retry(req.user,validate.id(req.params.id))})));
router.get('/lectures/:id/recommendations',wrap(async (req,res) => {
  const lecture = await store.getLecture(req.user,validate.id(req.params.id));
  const attempts = await store.attempts(req.user,lecture.id);
  const concepts = new Map();
  for (const attempt of attempts) for (const item of attempt.feedback) {
    if (item.correct === null) continue;
    const current = concepts.get(item.concept) || {concept:item.concept,correct:0,total:0,citations:item.citations || []};
    current.total++; if (item.correct) current.correct++;
    concepts.set(item.concept,current);
  }
  const weak = [...concepts.values()].filter((item) => item.total >= 3 && item.correct / item.total < 0.6);
  const course = await enrollment(req.user,lecture.enrollment_id);
  const prediction = course ? await getCurrentStudentPrediction(req.user.id_student,course.code_module,course.code_presentation) : null;
  res.json({weak_concepts:weak,course,prediction:prediction ? {
    risk_level:prediction.risk_level,risk_probability:prediction.risk_probability,
    recommended_action:prediction.recommended_action,created_at:prediction.created_at,
  } : null,steps:weak.length ? ['Review the cited lecture sections','Ask the lecture chat to explain your mistake','Try a short new practice quiz'] :
    ['Read the lecture summary','Complete a practice quiz to identify concepts to review'],
  academic_records_changed:false});
}));
module.exports = router;
