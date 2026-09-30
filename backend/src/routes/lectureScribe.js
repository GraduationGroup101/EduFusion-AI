const express = require('express');
const { authenticate } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/limits');
const store = require('../db/appStore');
const cache = require('../db/lectureCache');
const tools = require('../lectureTools');
const { text, badRequest, object, choice } = require('../lib/validation');
const { requestUpstream, readJson, upstreamStatus, sendError } = require('../lib/upstream');
const { LECTURESCRIBE_BASE: BASE, videoId, gatewayHeaders } = require('../lib/lectureScribe');
const router = express.Router();
router.use(authenticate);
const validateJob = (body) => {
  object(body);
  let url;
  try { url = new URL(text(body.youtube_url, 'YouTube URL', { max: 2048 })); }
  catch { throw badRequest('Enter an HTTPS YouTube URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(url.hostname)) throw badRequest('Enter an HTTPS YouTube URL');
  if (body.clean !== undefined && typeof body.clean !== 'boolean') throw badRequest('clean must be a boolean');
  if (body.language !== undefined && !['ar','en','auto'].includes(body.language)) throw badRequest('Unsupported language');
  return { youtube_url: url.href, clean: body.clean ?? true, skip_audio_cache: false, use_cached_outputs: true,
    ...(body.language && body.language !== 'auto' ? { language: body.language } : {}) };
};
const jobTitle = (job) => job?.title || job?.result?.title || job?.request?.youtube_url || 'Lecture transcript';
const chatSession = (jobId) => `lecture:${jobId}`;

// Cached copy first; the transcription service keeps files on ephemeral hosting,
// so a completed transcript is persisted the first time it is read.
const loadTranscript = async (req, jobId, kind) => {
  const stored = await cache.getTranscript(jobId, kind);
  if (stored !== null) return stored;
  const response = await requestUpstream(req, `${BASE}/jobs/${encodeURIComponent(jobId)}/transcript?kind=${kind}`, {}, { timeoutMs: 30000, maxBytes: cache.MAX_TRANSCRIPT_CHARS });
  if (!response.ok) return null;
  const content = await response.text();
  if (content.trim()) {
    const job = await store.getAnyJob(jobId);
    await cache.saveTranscript(jobId, kind, content, { videoId: videoId(job?.request?.youtube_url), title: job?.title || job?.result?.title || null });
  }
  return content;
};
// The best readable text for lecture tools: formatted output, then raw Whisper output.
const loadAnyTranscript = async (req, jobId) => (await loadTranscript(req, jobId, 'cleaned')) || (await loadTranscript(req, jobId, 'raw'));

router.get('/health', async (req,res) => {
  try { const response = await requestUpstream(req, `${BASE}/health`, {}, { timeoutMs:15000 }); res.status(upstreamStatus(response.status)).json(await readJson(response)); }
  catch(error) { sendError(res,error); }
});
router.get('/tools/status', (req, res) => res.json({ enabled: tools.enabled() }));
router.post('/jobs', aiLimiter, async (req,res) => {
  try {
    const body=validateJob(req.body);
    // A lecture another account already transcribed is served from the cache:
    // this account gains entitlement to the finished job without re-processing.
    const cached=await cache.findCachedByVideo(videoId(body.youtube_url));
    if(cached) {
      const previous=await store.getAnyJob(cached.job_id);
      const job={...previous,job_id:cached.job_id,status:'completed',cached:true,submitted_at:Math.floor(Date.now()/1000),
        request:{...(previous?.request||{}),...body},title:previous?.title||cached.title||undefined,
        result:{...(previous?.result||{}),...(cached.kind==='cleaned'?{cleaned_transcript_path:previous?.result?.cleaned_transcript_path||'cached'}:{})}};
      await store.saveJob(req.user,job);
      return res.status(200).json(job);
    }
    const response=await requestUpstream(req,`${BASE}/jobs`,{method:'POST',headers:{'Content-Type':'application/json',...gatewayHeaders(req.user)},body:JSON.stringify(body)},{timeoutMs:30000});
    const data=await readJson(response);
    if(response.ok) {
      if(typeof data.job_id !== 'string' || !data.job_id || data.job_id.length > 200) throw Object.assign(new Error('Invalid job response'), {statusCode:502});
      await store.saveJob(req.user,{...data,request:body});
    }
    res.status(upstreamStatus(response.status)).json(data);
  } catch(error) { sendError(res,error); }
});
router.get('/jobs', async(req,res)=>{
  try {
    if(req.user.role!=='admin')return res.json({jobs:await store.listJobs(req.user)});
    const saved=await store.listAllJobs();
    try {
      const response=await requestUpstream(req,`${BASE}/jobs`,{},{timeoutMs:15000,maxBytes:4*1024*1024});
      if(!response.ok)throw new Error('Provider list unavailable');
      const data=await readJson(response);
      if(!Array.isArray(data.jobs))throw new Error('Invalid provider list');
      const merged=new Map(saved.map(job=>[job.job_id,job]));
      for(const job of data.jobs)if(typeof job?.job_id==='string'&&job.job_id.length>0&&job.job_id.length<=200)merged.set(job.job_id,job);
      return res.json({jobs:[...merged.values()].sort((a,b)=>(b.submitted_at||0)-(a.submitted_at||0)),scope:'all'});
    }catch{return res.json({jobs:saved,scope:'all',warning:'The transcription service could not refresh its list. Previously saved jobs are shown.'});}
  }
  catch(error) { sendError(res,error,'Unable to load your lecture jobs'); }
});
// Students need creation entitlement; administrators can inspect all transcripts.
router.use('/jobs/:jobId',async(req,res,next)=>{
  try {
    const id=text(req.params.jobId,'Job ID',{max:200});
    if(req.user.role!=='admin'&&!await store.ownsJob(req.user,id)) return res.status(404).json({error:'Job not found'});
    req.lectureJobId=id;return next();
  } catch(error) { return sendError(res,error); }
});
router.get('/jobs/:jobId',async(req,res)=>{
  try {
    const saved=req.user.role==='admin'?await store.getAnyJob(req.lectureJobId):(await store.listJobs(req.user)).find(job=>job.job_id===req.lectureJobId);
    // A cached transcript stays readable even when the provider forgot the job.
    if(saved?.status==='completed'&&await cache.getTranscript(req.lectureJobId,saved.result?.cleaned_transcript_path?'cleaned':'raw')!==null) return res.json(saved);
    const response=await requestUpstream(req,`${BASE}/jobs/${encodeURIComponent(req.lectureJobId)}`,{},{timeoutMs:30000});
    const data=await readJson(response);
    if(response.ok) {
      const job={...data,job_id:req.lectureJobId};
      if(req.user.role==='admin')await store.refreshAnyJob(job);
      else await store.refreshJob(req.user,job);
    }
    res.status(upstreamStatus(response.status)).json(data);
  } catch(error) { sendError(res,error); }
});
router.get('/jobs/:jobId/transcript',async(req,res)=>{
  try {
    const kind=req.query.kind ?? 'cleaned';
    if(!['raw','cleaned'].includes(kind)) throw badRequest('Invalid transcript kind');
    const content=await loadTranscript(req,req.lectureJobId,kind);
    if(content===null) return res.status(404).json({error:'Unable to load transcript'});
    return res.type('text/plain; charset=utf-8').send(content);
  } catch(error) { return sendError(res,error); }
});

// Lecture tools: grounded chat and practice questions over the saved transcript.
const requireTools=(req,res,next)=>tools.enabled()?next():res.status(503).json({error:'Lecture tools are not enabled on this server yet'});
const withTranscript=async(req,res)=>{
  const transcript=await loadAnyTranscript(req,req.lectureJobId);
  if(!transcript||transcript.trim().length<100) { res.status(409).json({error:'The transcript is not ready yet. Wait for the lecture to finish.'}); return null; }
  const job=await store.getAnyJob(req.lectureJobId);
  return {transcript,title:jobTitle(job)};
};
const toolError=(res,error)=>{
  if(error.statusCode&&error.statusCode<500) return res.status(error.statusCode).json({error:error.message});
  console.error('Lecture tool failed:',error.code||error.name);
  return res.status(error.name==='AbortError'||error.name==='TimeoutError'?504:503).json({error:'The lecture assistant is temporarily unavailable. Please try again.'});
};
router.get('/jobs/:jobId/chat',requireTools,async(req,res)=>{
  try { res.json({messages:await store.getHistory(req.user,chatSession(req.lectureJobId))}); }
  catch(error) { toolError(res,error); }
});
router.post('/jobs/:jobId/chat',requireTools,aiLimiter,async(req,res)=>{
  try {
    object(req.body);
    const question=text(req.body.question,'Question',{max:2000});
    const material=await withTranscript(req,res);
    if(!material)return;
    const history=await store.getHistory(req.user,chatSession(req.lectureJobId));
    const reply=await tools.answer({...material,history,question});
    await store.appendExchange(req.user,chatSession(req.lectureJobId),question,reply);
    res.json({...reply,session_id:chatSession(req.lectureJobId)});
  } catch(error) { toolError(res,error); }
});
router.delete('/jobs/:jobId/chat',requireTools,async(req,res)=>{
  try { await store.deleteHistory(req.user,chatSession(req.lectureJobId)); res.json({success:true}); }
  catch(error) { toolError(res,error); }
});
router.get('/jobs/:jobId/quizzes',requireTools,async(req,res)=>{
  try { res.json({quizzes:await cache.listQuizzes(req.user,req.lectureJobId)}); }
  catch(error) { toolError(res,error); }
});
router.post('/jobs/:jobId/quizzes',requireTools,aiLimiter,async(req,res)=>{
  try {
    object(req.body);
    const wanted=tools.counts(req.body);
    const language=req.body.language===undefined?'auto':choice(req.body.language,'language',['auto','ar','en']);
    const material=await withTranscript(req,res);
    if(!material)return;
    const questions=await tools.generateQuestions({...material,wanted,language});
    res.status(201).json({quiz:await cache.saveQuiz(req.user,req.lectureJobId,language,questions)});
  } catch(error) { toolError(res,error); }
});
module.exports=router;
