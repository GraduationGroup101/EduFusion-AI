const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/limits');
const store = require('../db/appStore');
const cache = require('../db/lectureCache');
const library = require('../lectureLibrary');
const tools = require('../lectureTools');
const { text, integer, badRequest, object, choice } = require('../lib/validation');
const { requestUpstream, readJson, upstreamStatus, sendError } = require('../lib/upstream');
const { LECTURESCRIBE_BASE: BASE, videoId } = require('../lib/lectureScribe');
const router = express.Router();

const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];
// Every URL form of a lecture is reduced to one canonical video URL, so it shares
// one stored copy, and a playlist link can never submit a whole playlist.
const validateJob = (body) => {
  object(body);
  let url;
  try { url = new URL(text(body.youtube_url, 'YouTube URL', { max: 2048 })); }
  catch { throw badRequest('Enter an HTTPS YouTube URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !YOUTUBE_HOSTS.includes(url.hostname)) throw badRequest('Enter an HTTPS YouTube URL');
  const id = videoId(url.href);
  if (!id) throw badRequest('Enter a single YouTube video URL');
  if (body.clean !== undefined && typeof body.clean !== 'boolean') throw badRequest('clean must be a boolean');
  const language = body.language ?? 'auto';
  if (!['auto', 'ar', 'en'].includes(language)) throw badRequest('Unsupported language');
  return { videoId: id, request: { youtube_url: `https://www.youtube.com/watch?v=${id}`, clean: body.clean ?? true, language } };
};
const compact = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const progressOf = (job) => compact(Object.fromEntries(library.STATUS_FIELDS.filter((key) => key !== 'submitted_at').map((key) => [key, job[key]])));
const kindsOf = async (jobId) => (await cache.availableKinds([jobId])).get(jobId) || [];
const jobTitle = (job) => job?.title || job?.result?.title || job?.youtube_url || job?.request?.youtube_url || 'Lecture transcript';
const chatSession = (jobId) => `lecture:${jobId}`;

// LectureScribe reports finished jobs here, signed with the gateway key, so a
// lecture is stored even when no student is watching it. Serverless hosts freeze
// once the response is sent, so the sync completes before answering.
router.post('/callback', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const jobId = typeof body.job_id === 'string' ? body.job_id : '';
    const status = typeof body.status === 'string' ? body.status : '';
    if (!library.verifyCallback({ timestamp: req.get('X-LectureScribe-Timestamp'), signature: req.get('X-LectureScribe-Signature'), jobId, status }))
      return res.status(401).json({ error: 'Invalid signature' });
    if (!library.JOB_ID.test(jobId) || !await store.getAnyJob(jobId)) return res.json({ ok: true, known: false });
    const { job, reachable } = await library.syncJob(jobId);
    // LectureScribe retries a failed notice: a finished lecture is acknowledged only once its transcripts are stored.
    if (!reachable || library.awaitingTranscripts(job, await kindsOf(jobId)))
      return res.status(503).json({ error: 'The transcript could not be stored yet' });
    return res.json({ ok: true });
  } catch (error) { return sendError(res, error, 'Unable to record this job'); }
});

router.use(authenticate);

router.get('/health', async (req, res) => {
  try { const response = await requestUpstream(req, `${BASE}/health`, { headers: library.providerHeaders() }, { timeoutMs: 15000 }); res.status(upstreamStatus(response.status)).json(await readJson(response)); }
  catch (error) { sendError(res, error); }
});
router.get('/tools/status', (req, res) => res.json({ enabled: tools.enabled() }));

// A stored lecture becomes this account's own saved copy (with this account's
// request), completed at once without any new transcription. `produced` is the
// mode of the reused text (a fast request may receive an AI-formatted copy).
const saveStoredCopy = async (user, jobId, own, source, produced) => {
  const kinds = await kindsOf(jobId);
  // Re-submitting a lecture this account already saved returns that save unchanged.
  const mine = await store.getJob(user, jobId);
  if (mine) return library.publicJob(mine, kinds);
  const original = await store.getAnyJob(jobId) || {};
  const detected = source.detected_language || original.detected_language;
  const formatVersion = source.format_version || original.format_version;
  const job = compact({ job_id: jobId, status: 'completed', stage: 'completed', progress_percent: 100, cached: true, finished_at: own.submitted_at,
    title: source.title || original.title, detected_language: detected, format_version: formatVersion, ...own,
    result: compact({ has_cleaned: kinds.includes('cleaned'), has_raw: kinds.includes('raw'), detected_language: detected, format_version: formatVersion,
      mode: produced }) });
  await store.saveJob(user, job);
  return library.publicJob(job, kinds);
};
// The provider's explanation is relayed for requests it refused (invalid video,
// rate limit); its outages and credential problems become generic errors.
const providerRefusal = async (res, response) => {
  let detail = null;
  try { detail = await response.json(); } catch { /* Not a JSON error body. */ }
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) res.set('Retry-After', retryAfter);
  if (response.status >= 500 || [401, 403].includes(response.status))
    return res.status(response.status >= 500 ? 503 : 502).json({ error: 'The transcription service is temporarily unavailable. Please try again.' });
  const message = [detail?.detail, detail?.error].find((value) => typeof value === 'string' && value.trim());
  return res.status(response.status).json({ error: message ? message.slice(0, 300) : 'The transcription service could not accept this lecture.' });
};
router.post('/jobs', aiLimiter, async (req, res) => {
  try {
    const { videoId: id, request } = validateJob(req.body);
    const mode = library.modeOf(request);
    const lecture = { videoId: id, language: request.language, mode };
    const own = { request, video_id: id, youtube_url: request.youtube_url, language: request.language, mode, submitted_at: Math.floor(Date.now() / 1000) };
    const reusable = await library.findReusable(lecture);
    if (reusable) return res.status(200).json(await saveStoredCopy(req.user, reusable.job_id, own, reusable, reusable.mode));
    // The same lecture, language and mode still being transcribed is shared, not started twice.
    const inflight = await library.findInflight(lecture);
    const produced = library.producedModeOf(inflight);
    // A shared job that finished without AI formatting is not what a formatted request asked for: it is formatted anew.
    if (inflight?.status === 'completed' && !(mode === 'formatted' && produced === 'fast'))
      return res.status(200).json(await saveStoredCopy(req.user, inflight.job_id, own, inflight, produced));
    if (inflight && inflight.status !== 'completed') {
      const mine = await store.getJob(req.user, inflight.job_id);
      if (mine) return res.status(202).json(library.publicJob(mine));
      const job = compact({ ...progressOf(inflight), jobs_ahead: inflight.jobs_ahead, job_id: inflight.job_id, shared: true, title: inflight.title,
        detected_language: inflight.detected_language, ...own });
      await store.saveJob(req.user, job);
      return res.status(202).json(library.publicJob(job));
    }
    const title = library.lookupTitle(request.youtube_url);
    const callback_url = library.callbackUrl(req);
    // Not tied to the browser connection (a cold provider can take a minute):
    // a job the provider accepted is always saved.
    const response = await requestUpstream(null, `${BASE}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...library.providerHeaders(req.user) },
      body: JSON.stringify({ ...request, skip_audio_cache: false, use_cached_outputs: true, ...(callback_url ? { callback_url } : {}) }) }, { timeoutMs: 60000 });
    if (!response.ok) return await providerRefusal(res, response);
    const data = await readJson(response);
    if (typeof data?.job_id !== 'string' || !library.JOB_ID.test(data.job_id)) throw Object.assign(new Error('Invalid job response'), { statusCode: 502 });
    const job = compact({ ...data, status: data.status || 'queued', ...own, title: data.title || await title });
    await store.saveJob(req.user, job);
    // LectureScribe answers a request it already finished with 'completed' at once:
    // store both transcript kinds now, so the reply offers them and the lecture is reusable.
    if (job.status === 'completed') {
      const { job: synced } = await library.syncJob(job.job_id, { user: req.user });
      if (synced) return res.status(202).json(library.publicJob(synced, await kindsOf(job.job_id)));
    }
    return res.status(202).json(library.publicJob(job));
  } catch (error) { return sendError(res, error); }
});

// Unfinished jobs, and recently finished ones whose transcripts are not all stored
// (a download failed), are reconciled with the provider within a time budget.
const syncSaved = async (jobs, options = {}) => {
  const stored = await cache.availableKinds(jobs.map((job) => job.job_id));
  return library.syncPending(jobs, { ...options,
    include: (job) => library.finishedRecently(job) && library.awaitingTranscripts(job, stored.get(job.job_id)) });
};

// Students see their own saves; administrators see every saved lecture once,
// with who saved it.
router.get('/jobs', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      const jobs = await syncSaved(await store.listJobs(req.user), { user: req.user });
      const kinds = await cache.availableKinds(jobs.map((job) => job.job_id));
      return res.json({ jobs: jobs.map((job) => library.publicJob(job, kinds.get(job.job_id))) });
    }
    const lectures = await store.listLectures();
    const jobs = await syncSaved(lectures.map((lecture) => lecture.job));
    const [kinds, owners] = await Promise.all([cache.availableKinds(lectures.map((lecture) => lecture.job_id)),
      library.describeOwners(lectures.flatMap((lecture) => lecture.owners.map((owner) => owner.owner_key)))]);
    return res.json({ scope: 'all', jobs: lectures.map((lecture, index) => ({ ...library.publicJob(jobs[index], kinds.get(lecture.job_id)),
      saved_by: lecture.owners.map((owner) => ({ ...owners.get(owner.owner_key), saved_at: owner.saved_at })), saved_count: lecture.owners.length })) });
  } catch (error) { return sendError(res, error, 'Unable to load your lecture jobs'); }
});
router.get('/admin/saves', requireRole(['admin']), async (req, res) => {
  try {
    const q = req.query.q === undefined || req.query.q === '' ? null : text(req.query.q, 'Search', { max: 200 });
    const limit = integer(req.query.limit ?? 25, 'Limit', 1, 100);
    const offset = integer(req.query.offset ?? 0, 'Offset', 0, 1000000);
    const { rows, total } = await store.listSaves({ q, limit, offset });
    return res.json({ total, limit, offset, saves: rows.map((row) => {
      const job = library.publicJob(row.job);
      return { owner: library.ownerDescriptor(row.owner_key, row), job_id: row.job_id, title: job.title, youtube_url: job.youtube_url,
        language: job.language, detected_language: job.detected_language, mode: job.mode, status: job.status, lost: job.lost,
        saved_at: row.created_at, has_transcript: Boolean(row.has_transcript) };
    }) });
  } catch (error) { return sendError(res, error, 'Unable to load saved lectures'); }
});

// Students need a saved entitlement; administrators can inspect all transcripts.
router.use('/jobs/:jobId', async (req, res, next) => {
  try {
    const id = req.params.jobId;
    if (!library.JOB_ID.test(id)) return res.status(400).json({ error: 'Invalid job ID' });
    if (req.user.role !== 'admin' && !await store.ownsJob(req.user, id)) return res.status(404).json({ error: 'Job not found' });
    req.lectureJobId = id; return next();
  } catch (error) { return sendError(res, error); }
});
router.get('/jobs/:jobId', async (req, res) => {
  try {
    const id = req.lectureJobId, scope = req.user.role === 'admin' ? {} : { user: req.user };
    const saved = scope.user ? await store.getJob(req.user, id) : await store.getAnyJob(id);
    // A stored transcript stays readable even when the provider forgot the job.
    const stored = await kindsOf(id);
    const readable = saved?.status === 'completed' && stored.length > 0;
    if (readable && !library.missingKinds(saved, stored).length) return res.json(library.publicJob(saved, stored));
    // A kind whose download failed is fetched again, without keeping a readable lecture waiting on a sleeping provider.
    const { job, reachable } = await library.syncJob(id, { ...scope, ...(readable ? { timeoutMs: 8000 } : {}) });
    if (!job) return reachable ? res.status(404).json({ error: 'Job not found' }) : res.status(503).json({ error: 'The transcription service is temporarily unavailable' });
    const view = library.publicJob(job, await kindsOf(id));
    // A provider outage keeps the saved job visible instead of failing the request; a stored lecture needs no provider.
    return res.json(reachable || readable ? view : { ...view, provider_unavailable: true });
  } catch (error) { return sendError(res, error); }
});
router.get('/jobs/:jobId/transcript', async (req, res) => {
  try {
    const kind = req.query.kind ?? 'cleaned';
    if (!library.KINDS.includes(kind)) throw badRequest('Invalid transcript kind');
    const transcript = await library.readTranscript(req.lectureJobId, kind, { user: req.user });
    if (!transcript) return res.status(404).json({ error: 'This transcript is not available.' });
    if (transcript.language) res.set('Content-Language', transcript.language);
    return res.type('text/plain; charset=utf-8').send(transcript.content);
  } catch (error) { return sendError(res, error); }
});

// Lecture tools: grounded chat and practice questions over the saved transcript.
const requireTools=(req,res,next)=>tools.enabled()?next():res.status(503).json({error:'Lecture tools are not enabled on this server yet'});
const withTranscript=async(req,res)=>{
  const transcript=await library.loadAnyTranscript(req.lectureJobId,{user:req.user});
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
    // A saved lecture's conversation lasts as long as the lecture.
    await store.appendExchange(req.user,chatSession(req.lectureJobId),question,reply,{persistent:true});
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
