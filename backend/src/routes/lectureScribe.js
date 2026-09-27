const express = require('express');
const { authenticate } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/limits');
const store = require('../db/appStore');
const { text, badRequest, object } = require('../lib/validation');
const { requestUpstream, readJson, upstreamStatus, sendError } = require('../lib/upstream');
const router = express.Router();
const BASE = (process.env.LECTURESCRIBE_API_URL || 'https://lecturescribe.app').replace(/\/+$/, '');
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
router.get('/health', async (req,res) => {
  try { const response = await requestUpstream(req, `${BASE}/health`, {}, { timeoutMs:15000 }); res.status(upstreamStatus(response.status)).json(await readJson(response)); }
  catch(error) { sendError(res,error); }
});
router.post('/jobs', aiLimiter, async (req,res) => {
  try {
    const body=validateJob(req.body);
    const response=await requestUpstream(req,`${BASE}/jobs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},{timeoutMs:30000});
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
    const response=await requestUpstream(req,`${BASE}/jobs/${encodeURIComponent(req.lectureJobId)}/transcript?kind=${kind}`,{},{timeoutMs:30000});
    if(!response.ok) return res.status(upstreamStatus(response.status)).json({error:'Unable to load transcript'});
    return res.type('text/plain; charset=utf-8').send(await response.text());
  } catch(error) { return sendError(res,error); }
});
module.exports=router;
