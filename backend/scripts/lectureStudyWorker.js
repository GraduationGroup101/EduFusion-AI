require('dotenv').config();
const { spawn } = require('node:child_process');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const store = require('../src/lectureStudy/store');
const db = require('../src/lectureStudy/database');
const { pool } = require('../src/db');
const { getStudentUserById, getUserById } = require('../src/db/queries');
const cache = require('../src/db/lectureCache');
const library = require('../src/lectureLibrary');
const { LECTURESCRIBE_BASE, videoId } = require('../src/lib/lectureScribe');
const { requestUpstream, readJson } = require('../src/lib/upstream');

class Processor {
  constructor() { this.child = null; this.pending = null; this.buffer = ''; }
  start() {
    this.child = spawn(process.env.LECTURE_STUDY_PYTHON || 'python',
      ['-u',path.resolve(__dirname,'../../services/lecture-study/engine.py')],
      { windowsHide:true, stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'} });
    const child = this.child;
    child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (data) => {
      this.buffer += data;
      if (this.buffer.length > 12*1024*1024) return this.stop(new Error('Worker output exceeds limit'));
      let newline;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0,newline); this.buffer = this.buffer.slice(newline+1);
        if (!this.pending) continue;
        const pending = this.pending;
        try {
          const data = JSON.parse(line);
          if(data.progress){
            pending.progress=pending.progress.then(()=>pending.onProgress(data.progress));
            pending.progress.catch(()=>{if(this.child===child)this.stop(new Error('Preparation checkpoint failed'));});
            continue;
          }
          this.pending=null;clearTimeout(pending.timer);
          if(data.error)pending.reject(new Error('Local AI failed: '+data.error));
          else pending.progress.then(()=>pending.resolve(data.result),pending.reject);
        } catch(error){this.pending=null;clearTimeout(pending.timer);pending.reject(error);}
      }
    });
    // Model loaders may log progress; keep document/model prompts out of logs.
    this.child.stderr.on('data', () => {});
    this.child.on('error', () => {if(this.child===child)this.stop(new Error('Python runtime is unavailable'));});
    this.child.on('exit', () => {if(this.child===child)this.stop(new Error('Local AI process stopped'));});
  }
  run(context,onProgress=async()=>{}) {
    if (!this.child) this.start();
    if (this.pending) return Promise.reject(new Error('Processor is already busy'));
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => this.stop(new Error('Local AI processing deadline exceeded')), 45*60*1000);
      this.pending = {resolve,reject,timer,onProgress,progress:Promise.resolve()};
      this.child.stdin.write(JSON.stringify(context) + '\n', (error) => { if (error) this.stop(error); });
    });
  }
  stop(error = new Error('Worker stopped')) {
    const child = this.child; this.child = null; this.buffer = '';
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; }
    child?.kill();
  }
}
const activeAccount = async (owner) => {
  const match = /^(student|user):(\d+)$/.exec(owner);
  if (!match) throw new Error('Invalid job owner');
  const user = await (match[1] === 'student' ? getStudentUserById(Number(match[2])) : getUserById(Number(match[2])));
  if (!user?.is_active) throw new Error('Job owner is inactive');
  return user;
};
// Study preparation always asks for the AI-formatted transcript.
const MODE = 'formatted';
const POLL_MS = 5000;
// LectureScribe runs on hosting that restarts and forgets jobs; a lost job is
// submitted again, but only a few times per attempt.
const MAX_SUBMISSIONS = 3;
// Consecutive unreachable/5xx answers tolerated (about two minutes of backoff),
// which covers a free-hosting cold start without burning a whole attempt.
const MAX_PROVIDER_FAILURES = 8;
const PLACEHOLDER_TITLE = /^Lecture [\w-]{11}$/;
const TRANSCRIPT_BYTES = 4*1024*1024;
const provider = (path,options = {},limits = {}) =>
  requestUpstream(null,LECTURESCRIBE_BASE + path,options,{timeoutMs:30000,maxBytes:1024*1024,...limits});
const logFailure = (message,error) => console.error(message,error?.code || error?.name || 'Error');
// A formatted copy in another language than the speech was translated (older
// LectureScribe versions did this); the spoken-language text is studied instead.
const translated = (cleaned,raw) => {
  const written = library.detectTextLanguage(cleaned), spoken = library.detectTextLanguage(raw);
  return Boolean(written && spoken && written !== spoken);
};
const forgetProviderJob = async (job,context) => {
  context.lecture.provider_job_id = null;
  await db.query("UPDATE study_lectures SET provider_job_id=NULL WHERE id=$1 AND EXISTS(SELECT 1 FROM study_jobs WHERE id=$2 AND lease_token=$3 AND status='running')", [job.lecture_id,job.id,job.lease_token]);
};
// A lecture still named after its video gets its real title, best effort.
const realTitle = async (lecture,known) => known || (PLACEHOLDER_TITLE.test(lecture.lecture_title ?? lecture.title ?? '') ? library.lookupTitle(lecture.youtube_url) : null);
const publish = async (job,context,{cleaned,raw,title}) => {
  const transcript = cleaned && !(raw && translated(cleaned,raw)) ? cleaned : raw || cleaned;
  if (!transcript?.trim()) throw new Error('Empty transcript');
  await store.checkpoint(job,'summarizing',{raw_transcript:raw || null,transcript,title:await realTitle(context.lecture,title)});
  context.lecture.raw_transcript = raw || context.lecture.raw_transcript || null; context.lecture.transcript = transcript;
};
// EduFusion's durable library may already hold this lecture in the requested
// language (from any student or flow): reuse it instead of transcribing again.
// Its database is separate from the learning one, so it is optional here.
const storedLecture = async (lecture,user) => {
  const video = videoId(lecture.youtube_url);
  if (!video) return null;
  try {
    const row = await library.findReusable({videoId:video,language:lecture.language || 'auto',mode:MODE});
    if (!row) return null;
    const cleaned = await library.loadTranscript(row.job_id,'cleaned',{user,timeoutMs:15000});
    const raw = await library.loadTranscript(row.job_id,'raw',{user,timeoutMs:15000});
    return cleaned || raw ? {cleaned,raw,title:row.title || null} : null;
  } catch (error) { logFailure('Stored lecture lookup failed:',error); return null; }
};
// Copies what the provider produced into the durable library so the next
// request for this lecture (study or LectureScribe page) is answered instantly.
const keepTranscripts = async (providerId,lecture,current,texts,title) => {
  const formatVersion = current.format_version || current.result?.format_version || null;
  const detected = library.normalizeLanguage(current.detected_language ?? current.result?.detected_language);
  // A formatted request no model could format is reported as 'fast': never reuse it as AI formatting.
  const mode = [current.result?.mode,current.mode].find((value) => ['formatted','fast'].includes(value)) || MODE;
  for (const kind of ['cleaned','raw']) {
    const text = texts[kind];
    if (!text) continue;
    // A translated formatted copy is kept for reading but never offered for reuse.
    const reusable = !(kind === 'cleaned' && texts.raw && translated(text,texts.raw));
    try {
      await cache.saveTranscript(providerId,kind,text,{videoId:videoId(lecture.youtube_url),youtubeUrl:lecture.youtube_url,title,
        language:lecture.language || 'auto',mode,detectedLanguage:detected || texts.languages[kind] || library.detectTextLanguage(text),
        formatVersion:reusable ? formatVersion : null});
    } catch (error) { logFailure('Lecture transcript could not be stored:',error); }
  }
};
// Both kinds of a completed provider job: null when the provider could not be
// reached, 'lost' when it no longer has either file.
const download = async (providerId,headers) => {
  const texts = {languages:{}};
  let missing = 0;
  for (const kind of ['cleaned','raw']) {
    let response;
    try { response = await provider('/jobs/' + encodeURIComponent(providerId) + '/transcript?kind=' + kind,{headers},{timeoutMs:60000,maxBytes:TRANSCRIPT_BYTES}); }
    catch { return null; }
    if ([404,410].includes(response.status)) { missing++; continue; }
    if (!response.ok) return null;
    const text = await response.text();
    if (!text.trim()) { missing++; continue; }
    texts[kind] = text; texts.languages[kind] = library.normalizeLanguage(response.headers.get('content-language'));
  }
  return missing === 2 ? 'lost' : texts;
};
// The provider job id, or null when the provider is unreachable or busy.
const submit = async (lecture,headers) => {
  let response;
  try {
    response = await provider('/jobs',{method:'POST',headers:{'Content-Type':'application/json',...headers},
      // 'auto' is sent explicitly: an omitted language used to mean Arabic.
      body:JSON.stringify({youtube_url:lecture.youtube_url,clean:true,language:lecture.language || 'auto',use_cached_outputs:true,skip_audio_cache:false})},
    {timeoutMs:60000});
  } catch { return null; }
  if (response.status === 429 || response.status >= 500) return null;
  if (!response.ok) throw new Error('The transcription service rejected this lecture');
  const created = await readJson(response);
  if (typeof created.job_id !== 'string' || !library.JOB_ID.test(created.job_id)) throw new Error('Invalid provider job');
  return created.job_id;
};
const prepareTranscript = async (job,context,isStopping = () => false,{wait = delay} = {}) => {
  const lecture = context.lecture;
  if (lecture.transcript) {
    // An imported transcript: name the lecture, and study the spoken text if the formatted copy was translated.
    const spoken = lecture.raw_transcript && translated(lecture.transcript,lecture.raw_transcript) ? lecture.raw_transcript : null;
    const title = await realTitle(lecture,null);
    if (spoken || title) await store.checkpoint(job,'summarizing',{transcript:spoken,title});
    if (spoken) lecture.transcript = spoken;
    return;
  }
  // Every provider call carries the gateway key and a per-lecture account, so one
  // busy lecture cannot use up every student's transcription allowance.
  const user = {id:'lecture:' + lecture.id};
  const stored = await storedLecture(lecture,user);
  if (stored) return publish(job,context,stored);
  const headers = library.providerHeaders(user);
  let providerId = lecture.provider_job_id, submissions = 0, failures = 0;
  const unreachable = async () => {
    if (++failures >= MAX_PROVIDER_FAILURES) throw new Error('Lecture provider is unavailable');
    await wait(Math.min(30000,POLL_MS/2 * 2 ** (failures - 1)));
  };
  const deadline = Date.now() + 2*60*60*1000;
  while (!isStopping() && Date.now() < deadline) {
    if (!providerId) {
      if (submissions >= MAX_SUBMISSIONS) throw new Error('The transcription service keeps losing this lecture');
      const created = await submit(lecture,headers);
      if (!created) { await unreachable(); continue; }
      submissions++; failures = 0; providerId = lecture.provider_job_id = created;
      await store.checkpoint(job,'transcribing',{provider_job_id:providerId});
      continue;
    }
    let response;
    try { response = await provider('/jobs/' + encodeURIComponent(providerId),{headers}); } catch { response = null; }
    // The provider restarted and forgot the job: submit it again instead of polling a dead id.
    if (response && [404,410].includes(response.status)) { await forgetProviderJob(job,context); providerId = null; continue; }
    let current = null;
    if (response?.ok) { try { current = await response.json(); } catch { current = null; } }
    if (!current || typeof current !== 'object') { await unreachable(); continue; }
    if (current.status === 'failed') {
      // A failed provider job is never polled again; the next attempt submits anew.
      await forgetProviderJob(job,context);
      throw new Error('Transcript preparation failed');
    }
    if (current.status === 'completed') {
      const texts = await download(providerId,headers);
      if (texts === 'lost') { await forgetProviderJob(job,context); providerId = null; continue; }
      if (!texts) { await unreachable(); continue; }
      const title = current.title || current.result?.title || null;
      await keepTranscripts(providerId,lecture,current,texts,title);
      return publish(job,context,{cleaned:texts.cleaned || null,raw:texts.raw || null,title});
    }
    // Only progress resets the failure count: a completed job whose downloads keep
    // failing must still end the attempt instead of polling until the deadline.
    failures = 0;
    await wait(POLL_MS);
  }
  throw new Error(isStopping() ? 'Worker is shutting down' : 'Transcription deadline exceeded');
};
const processJob = async (job,processor,isStopping) => {
  await activeAccount(job.owner_key);
  const context = await store.workerContext(job);
  if (job.kind === 'prepare') await prepareTranscript(job,context,isStopping);
  await store.checkpoint(job,job.kind === 'prepare' ? 'summarizing' : 'generating');
  const result = await processor.run(context,job.kind==='prepare'?(progress)=>store.preparationProgress(job,progress):undefined);
  await activeAccount(job.owner_key);
  await store.complete(job,result);
};
const run = async () => {
  const workerId = 'lecture-' + randomUUID();
  const processor = new Processor();
  let stopping = false, dispatches = 0;
  const shutdown = () => { stopping = true; processor.stop(); };
  process.once('SIGINT',shutdown); process.once('SIGTERM',shutdown);
  await store.status(); // Fail before starting if learning migrations are missing.
  console.log('Independent lecture worker started');
  while (!stopping) {
    let job;
    try {
      job = await store.claimJob(workerId,dispatches % 4 === 3);
      if (!job) { await delay(5000); continue; }
      dispatches++;
      let leaseLost = false;
      const heartbeat = setInterval(async () => {
        try { if (!await store.renewLease(job,workerId)) { leaseLost = true; processor.stop(); } }
        catch { leaseLost = true; processor.stop(); }
      },30000);
      try { await processJob(job,processor,() => stopping || leaseLost); }
      catch {
        if (!leaseLost) await store.failJob(job,stopping ? 'Worker paused; the request will resume.' :
          'Local processing is temporarily unavailable. Check worker, model and transcription service.');
      } finally { clearInterval(heartbeat); }
    } catch (error) {
      console.error('Lecture worker cycle failed:', error.code || error.name);
      await delay(5000);
    }
  }
  processor.stop(); await db.close(); await pool.end();
};
if (require.main === module) run().catch(async (error) => {
  console.error('Lecture worker failed:',error.code || error.name); process.exitCode=1; await db.close(); await pool.end();
});
module.exports = { Processor,activeAccount,prepareTranscript,processJob };
