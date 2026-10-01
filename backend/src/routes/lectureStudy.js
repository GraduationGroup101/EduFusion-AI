const express = require('express');
const { authenticate,requireRole } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/limits');
const { text, integer, object } = require('../lib/validation');
const { readQuery } = require('../db');
const { getCurrentStudentPrediction } = require('../db/queries');
const legacy = require('../db/appStore');
const { requestUpstream,readJson } = require('../lib/upstream');
const { LECTURESCRIBE_BASE } = require('../lib/lectureScribe');
const db = require('../lectureStudy/database');
const store = require('../lectureStudy/store');
const validate = require('../lectureStudy/validation');
const lectureLibrary = require('../lectureLibrary');
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
// Who saved each lecture, for administrators, including members who removed it
// since (`removed_at`). Names live in the main database; if it cannot be read the
// savers are still listed by account.
const withMembers = async (lectures) => {
  let owners = new Map();
  try { owners = await lectureLibrary.describeOwners(lectures.flatMap((lecture) => (lecture.members || []).map((member) => member.owner_key))); }
  catch (error) { console.error('Lecture owners could not be described:', error.code || error.name); }
  return lectures.map((lecture) => ({ ...lecture, members: (lecture.members || []).map(({ owner_key, saved_at, removed_at }) =>
    ({ ...(owners.get(owner_key) || lectureLibrary.ownerDescriptor(owner_key)), saved_at, removed_at: removed_at ?? null })) }));
};
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
router.get('/admin/lectures',requireRole(['admin']),wrap(async(req,res)=>{
  const offset=integer(req.query.offset??0,'Offset',0,100000);
  res.json({lectures:await withMembers(await store.listAllLectures(offset)),offset});
}));
router.get('/admin/lectures/:id',requireRole(['admin']),wrap(async(req,res)=>{
  res.json({lecture:(await withMembers([await store.getLectureContent(validate.id(req.params.id))]))[0]});
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
  const own=await legacy.ownsJob(req.user,jobId);
  if ((!own&&req.user.role!=='admin')||!lectureLibrary.JOB_ID.test(jobId)) return res.status(404).json({error:'Job not found'});
  const base = LECTURESCRIBE_BASE, headers = lectureLibrary.providerHeaders(req.user);
  let job=own?await legacy.getJob(req.user,jobId):await legacy.getAnyJob(jobId);
  if(!job&&req.user.role==='admin'){
    const providerStatus=await requestUpstream(req,base+'/jobs/'+encodeURIComponent(jobId),{headers},{timeoutMs:30000});
    if(!providerStatus.ok)return res.status(404).json({error:'Job not found'});
    job=await readJson(providerStatus);
  }
  if(!own&&job?.request?.youtube_url)await legacy.saveJob(req.user,{...job,job_id:jobId});
  if (!job?.request?.youtube_url) return res.status(409).json({error:'This job has no saved source; add its YouTube URL again'});
  const source = validate.source({...job.request,enrollment_id:req.body.enrollment_id});
  await enrollment(req.user,source.enrollment_id);
  const previous=await store.preparationReplay(req.user,source,key);
  if(previous)return res.status(previous.lecture.status==='ready'?200:202).json({...previous,job:jobView(previous.job)});
  // A lecture already prepared (or being prepared) from this source is joined as
  // it is: no transcript is needed, so a provider that forgot the job is no obstacle.
  if(await store.sourceAvailable(source.source_key)){
    const linked=await store.createLecture(req.user,source,key);
    return res.status(linked.lecture.status==='ready'?200:202).json({...linked,job:jobView(linked.job)});
  }
  // EduFusion's stored copy first: the provider (ephemeral hosting) is asked only
  // when nothing is stored, and what it finished is stored for every later reader.
  // Only text from the fixed pipeline seeds a lecture: an older copy may be an
  // English translation of an Arabic lecture, and this lecture is shared by everyone
  // who saves the source, so it is prepared afresh in its own language instead.
  // Never accept transcript text or a provider URL supplied by the browser.
  let {cleaned,raw,stored}=await lectureLibrary.reusableTranscripts(jobId,job);
  if (!stored) {
    const {job:finished,reachable}=await lectureLibrary.syncJob(jobId,{user:req.user,timeoutMs:30000});
    if (!reachable||finished?.status!=='completed') return res.status(409).json({error:'The original transcript is not ready or its service is offline'});
    if (lectureLibrary.formatVersionOf(finished)) {
      // Both kinds: the spoken-language original lets the worker detect a translated formatted copy.
      [cleaned,raw]=await Promise.all(lectureLibrary.KINDS.map((kind)=>lectureLibrary.loadTranscript(jobId,kind,{user:req.user,job:finished})));
      if (cleaned===null&&raw===null) throw new Error('Transcript download failed');
    }
  }
  const imported = cleaned===null&&raw===null ? null : {transcript:text(cleaned??raw,'Transcript',{max:1024*1024}),
    ...(raw!==null&&raw.trim()&&raw.length<=1024*1024 ? {raw_transcript:raw} : {})};
  const result = await store.createLecture(req.user,source,key,imported);
  res.status(result.lecture.status === 'ready' ? 200 : 202).json({...result,job:jobView(result.job)});
}));
router.get('/lectures/:id',wrap(async (req,res) => res.json({lecture:await store.getLecture(req.user,validate.id(req.params.id))})));
router.get('/lectures/:id/transcript',wrap(async (req,res) => res.json({transcript:await store.getTranscript(req.user,validate.id(req.params.id))})));
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
