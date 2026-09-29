require('dotenv').config();
const { spawn } = require('node:child_process');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const store = require('../src/lectureStudy/store');
const db = require('../src/lectureStudy/database');
const { pool } = require('../src/db');
const { getStudentUserById, getUserById } = require('../src/db/queries');
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
const upstream = async (url,options = {}) => {
  const response = await requestUpstream(null,url,options,{timeoutMs:30000,maxBytes:1024*1024});
  if (!response.ok) throw new Error('Lecture provider is unavailable');
  return response;
};
const prepareTranscript = async (job,context,isStopping = () => false) => {
  if (context.lecture.transcript) return;
  const base = require('../src/lib/lectureScribe').LECTURESCRIBE_BASE;
  let providerId = context.lecture.provider_job_id;
  if (!providerId) {
    const created = await readJson(await upstream(base + '/jobs', {
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({youtube_url:context.lecture.youtube_url,clean:true,use_cached_outputs:true,skip_audio_cache:false,
        ...(context.lecture.language !== 'auto' ? {language:context.lecture.language} : {})}),
    }));
    if (typeof created.job_id !== 'string' || created.job_id.length > 200 || !created.job_id) throw new Error('Invalid provider job');
    providerId = created.job_id;
    await store.checkpoint(job,'transcribing',{provider_job_id:providerId});
  }
  const deadline = Date.now() + 2*60*60*1000;
  while (!isStopping() && Date.now() < deadline) {
    const current = await readJson(await upstream(base + '/jobs/' + encodeURIComponent(providerId)));
    if (current.status === 'failed') {
      // A provider restart marks its own jobs failed. A new request will reuse
      // its audio/transcript cache; our next attempt must not poll that job forever.
      await db.query("UPDATE study_lectures SET provider_job_id=NULL WHERE id=$1 AND EXISTS(SELECT 1 FROM study_jobs WHERE id=$2 AND lease_token=$3 AND status='running')", [job.lecture_id,job.id,job.lease_token]);
      throw new Error('Transcript preparation failed');
    }
    if (current.status === 'completed') {
      const raw = await (await upstream(base + '/jobs/' + encodeURIComponent(providerId) + '/transcript?kind=raw')).text();
      let cleaned;
      try { cleaned = await (await upstream(base + '/jobs/' + encodeURIComponent(providerId) + '/transcript?kind=cleaned')).text(); }
      catch { cleaned = raw; }
      if (!raw.trim() || !cleaned.trim()) throw new Error('Empty transcript');
      await store.checkpoint(job,'summarizing',{raw_transcript:raw,transcript:cleaned});
      context.lecture.raw_transcript = raw; context.lecture.transcript = cleaned;
      return;
    }
    await delay(5000);
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
