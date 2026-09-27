const { randomUUID } = require('node:crypto');
const db = require('./database');
const { ownerKey } = require('../lib/owner');
const { grade, fingerprint } = require('./validation');
const contracts = require('./contracts');
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
const json = (value) => JSON.stringify(value);
const lockOwner = (client, owner) => client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['study:' + owner]);
const usage=async(client,owner,kind)=>(await client.query("SELECT requests FROM study_usage WHERE owner_key=$1 AND kind=$2 AND day=(NOW() AT TIME ZONE 'UTC')::date",[owner,kind])).rows[0]?.requests||0;
const addUsage=(client,owner,kind)=>client.query("INSERT INTO study_usage(owner_key,day,kind,requests) VALUES($1,(NOW() AT TIME ZONE 'UTC')::date,$2,1) ON CONFLICT(owner_key,day,kind) DO UPDATE SET requests=study_usage.requests+1",[owner,kind]);
const owned = async (client, owner, lectureId, lock = false) => {
  const result = await client.query(
    'SELECT l.*,m.enrollment_id,COALESCE(m.title,l.title) AS title FROM study_lectures l JOIN study_members m ON m.lecture_id=l.id WHERE m.owner_key=$1 AND l.id=$2' +
      (lock ? ' FOR UPDATE OF l,m' : ''), [owner, lectureId]);
  if (!result.rowCount) fail(404, 'Lecture not found');
  return result.rows[0];
};
const replay = async (client, owner, key, kind, payload, lectureId) => {
  const result = await client.query('SELECT * FROM study_jobs WHERE owner_key=$1 AND request_key=$2', [owner,key]);
  if (!result.rowCount) return null;
  const job = result.rows[0];
  if (job.kind !== kind || (lectureId && job.lecture_id !== lectureId) || fingerprint(job.payload) !== fingerprint(payload)) fail(409, 'Idempotency key was used for a different request');
  return job;
};
const ensureCapacity = async (client) => {
  const max = Number(process.env.LECTURE_STUDY_MAX_DB_MB || 500);
  const result = await client.query('SELECT pg_database_size(current_database())::float AS bytes');
  if (result.rows[0].bytes >= max * 1024 * 1024 * 0.9) fail(429, 'Learning storage is almost full; existing content remains available');
};
const insertJob = async (client, owner, lecture, kind, key, payload) => {
  const id = randomUUID();
  return (await client.query(
    'INSERT INTO study_jobs(id,owner_key,lecture_id,version,kind,request_key,payload) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [id,owner,lecture.id,lecture.version,kind,key,json(payload)])).rows[0];
};
const createLecture = (user, source, key, imported = null) => db.transaction(async (client) => {
  const owner = ownerKey(user);
  await lockOwner(client, owner);
  const payload = { source_key: source.source_key, enrollment_id:source.enrollment_id, title:source.title };
  const existing = await replay(client, owner, key, 'prepare', payload);
  if (existing) return { lecture: await owned(client,owner,existing.lecture_id), job: existing, replayed: true };
  const count = await usage(client,owner,'prepare');
  const pending = (await client.query("SELECT COUNT(*)::int AS n FROM study_jobs WHERE owner_key=$1 AND kind='prepare' AND status IN ('queued','running')", [owner])).rows[0].n;
  let lecture = (await client.query('SELECT * FROM study_lectures WHERE source_key=$1 FOR UPDATE', [source.source_key])).rows[0];
  if (!lecture || lecture.status === 'failed') {
    if (count >= 2 || pending >= 2) fail(429, 'Lecture preparation quota reached; try again later');
    await ensureCapacity(client);
  }
  if (!lecture) {
    const lectureId = randomUUID();
    await client.query('INSERT INTO study_lectures(id,source_key,youtube_url,language,title) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_key) DO NOTHING',
      [lectureId,source.source_key,source.youtube_url,source.language,'Lecture ' + new URL(source.youtube_url).searchParams.get('v')]);
    lecture = (await client.query('SELECT * FROM study_lectures WHERE source_key=$1 FOR UPDATE', [source.source_key])).rows[0];
  }
  await client.query('INSERT INTO study_members(owner_key,lecture_id,enrollment_id,title) VALUES($1,$2,$3,$4) ON CONFLICT(owner_key,lecture_id) DO UPDATE SET enrollment_id=COALESCE(EXCLUDED.enrollment_id,study_members.enrollment_id),title=COALESCE(EXCLUDED.title,study_members.title)',
    [owner,lecture.id,source.enrollment_id,source.title]);
  let job;
  if (lecture.status !== 'ready') {
    job = (await client.query("SELECT * FROM study_jobs WHERE lecture_id=$1 AND kind='prepare' AND status IN ('queued','running') ORDER BY created_at LIMIT 1", [lecture.id])).rows[0];
    if (!job) {
      if (count >= 2 || pending >= 2) fail(429, 'Lecture preparation quota reached; try again later');
      await ensureCapacity(client);
      await client.query("UPDATE study_lectures SET status='queued',stage='queued',error=NULL WHERE id=$1", [lecture.id]);
      job = await insertJob(client,owner,lecture,'prepare',key,payload);
      await addUsage(client,owner,'prepare');
      if (imported) await client.query('UPDATE study_lectures SET transcript=$2,raw_transcript=$3 WHERE id=$1',
        [lecture.id,imported.transcript,imported.raw_transcript || imported.transcript]);
    }
  }
  // A cached or shared preparation result needs an owner-specific replay receipt.
  if (!job || job.owner_key !== owner || job.request_key !== key) {
    job = await insertJob(client,owner,lecture,'prepare',key,payload);
    await client.query("UPDATE study_jobs SET status='completed',stage='linked',result=$2 WHERE id=$1", [job.id,json({ linked: true })]);
    job.status = 'completed';
  }
  return { lecture: await owned(client,owner,lecture.id), job };
});
const preparationReplay=(user,source,key)=>db.transaction(async(client)=>{
  const owner=ownerKey(user);
  const payload={source_key:source.source_key,enrollment_id:source.enrollment_id,title:source.title};
  const job=await replay(client,owner,key,'prepare',payload);
  return job?{lecture:await owned(client,owner,job.lecture_id),job,replayed:true}:null;
});
const listLectures = async (user, offset = 0) => {
  const result = await db.query(
    "SELECT l.id,COALESCE(m.title,l.title) AS title,l.youtube_url,l.language,CASE WHEN l.status<>'ready' AND p.status='failed' THEN 'failed' ELSE l.status END AS status,l.stage,COALESCE(p.error,l.error) AS error,l.version,l.updated_at,m.enrollment_id FROM study_members m JOIN study_lectures l ON l.id=m.lecture_id LEFT JOIN LATERAL(SELECT status,error FROM study_jobs WHERE lecture_id=l.id AND kind='prepare' AND stage<>'linked' ORDER BY created_at DESC LIMIT 1)p ON true WHERE m.owner_key=$1 ORDER BY m.created_at DESC LIMIT 20 OFFSET $2", [ownerKey(user),offset]);
  return result.rows;
};
const getLecture = async (user,id) => {
  const lecture = await owned(db,ownerKey(user),id);
  const chunks = (await db.query('SELECT id,text,section,ordinal FROM study_chunks WHERE lecture_id=$1 AND version=$2 ORDER BY ordinal', [id,lecture.version])).rows;
  const jobs = (await db.query("SELECT id,kind,status,stage,error,created_at FROM study_jobs WHERE owner_key=$1 AND lecture_id=$2 AND status IN ('queued','running','failed') ORDER BY created_at DESC LIMIT 20", [ownerKey(user),id])).rows;
  if (lecture.status !== 'ready') {
    const preparation = (await db.query("SELECT status,error FROM study_jobs WHERE lecture_id=$1 AND kind='prepare' AND stage<>'linked' ORDER BY created_at DESC LIMIT 1",[id])).rows[0];
    if (preparation?.status === 'failed') { lecture.status='failed';lecture.error=preparation.error; }
  }
  return { ...lecture, chunks, jobs };
};
const enqueue = (user,lectureId,kind,key,payload) => db.transaction(async (client) => {
  const owner = ownerKey(user);
  await lockOwner(client,owner);
  const lecture = await owned(client,owner,lectureId,true);
  const previous = await replay(client,owner,key,kind,payload,lectureId);
  if (previous) return previous;
  if (lecture.status !== 'ready') fail(409,'This lecture is still being prepared');
  if (kind === 'quiz' && payload.section && !lecture.sections.some((section) => section.id === payload.section)) fail(400,'Unknown lecture section');
  const pending = (await client.query(
    "SELECT COUNT(*)::int AS n FROM study_jobs WHERE owner_key=$1 AND kind=$2 AND status IN ('queued','running')", [owner,kind])).rows[0].n;
  if (pending >= 3) fail(429,'You have three pending requests; wait for one to finish');
  const daily=await usage(client,owner,kind);
  if(daily >= (kind==='chat'?50:10))fail(429,'Daily study quota reached; try again tomorrow');
  if (kind === 'chat' && (await client.query("SELECT 1 FROM study_jobs WHERE owner_key=$1 AND lecture_id=$2 AND kind='chat' AND status IN ('queued','running')", [owner,lectureId])).rowCount) fail(409,'Wait for this lecture to answer your previous question');
  await ensureCapacity(client);
  const job = await insertJob(client,owner,lecture,kind,key,payload);
  await addUsage(client,owner,kind);
  if (kind === 'chat') await client.query('INSERT INTO study_messages(id,owner_key,lecture_id,version,job_id,question) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(),owner,lectureId,lecture.version,job.id,payload.question]);
  return job;
});
const getJob = async (user,jobId) => {
  const result = await db.query('SELECT j.* FROM study_jobs j JOIN study_members m ON m.owner_key=j.owner_key AND m.lecture_id=j.lecture_id WHERE j.id=$1 AND j.owner_key=$2', [jobId,ownerKey(user)]);
  if (!result.rowCount) fail(404,'Job not found');
  const job = {...result.rows[0]};
  delete job.payload;delete job.lease_token;
  return job;
};
const messages = async (user,lectureId) => {
  const lecture = await owned(db,ownerKey(user),lectureId);
  return (await db.query(
    "SELECT * FROM(SELECT m.*,j.status,j.error FROM study_messages m JOIN study_jobs j ON j.id=m.job_id WHERE m.owner_key=$1 AND m.lecture_id=$2 AND m.version=$3 AND m.created_at>NOW()-INTERVAL '90 days' ORDER BY m.created_at DESC LIMIT 500) recent ORDER BY created_at",
    [ownerKey(user),lectureId,lecture.version])).rows;
};
const quizzes = async (user,lectureId) => {
  await owned(db,ownerKey(user),lectureId);
  return (await db.query('SELECT id,lecture_id,version,created_at FROM study_quizzes WHERE owner_key=$1 AND lecture_id=$2 ORDER BY created_at DESC LIMIT 20', [ownerKey(user),lectureId])).rows;
};
const getQuiz = async (user,quizId) => {
  const result = await db.query('SELECT q.* FROM study_quizzes q JOIN study_members m ON m.owner_key=q.owner_key AND m.lecture_id=q.lecture_id WHERE q.id=$1 AND q.owner_key=$2', [quizId,ownerKey(user)]);
  if (!result.rowCount) fail(404,'Quiz not found');
  return result.rows[0];
};
const submitAttempt = (user,quizId,key,answers) => db.transaction(async (client) => {
  const owner = ownerKey(user);
  await lockOwner(client,owner);
  const previous = (await client.query('SELECT * FROM study_attempts WHERE owner_key=$1 AND request_key=$2', [owner,key])).rows[0];
  if (previous) {
    if (previous.quiz_id !== quizId || fingerprint(previous.answers) !== fingerprint(answers)) fail(409,'Idempotency key was used for a different submission');
    await owned(client,owner,previous.lecture_id);
    return previous;
  }
  const quiz = (await client.query('SELECT q.* FROM study_quizzes q JOIN study_members m ON m.owner_key=q.owner_key AND m.lecture_id=q.lecture_id WHERE q.id=$1 AND q.owner_key=$2', [quizId,owner])).rows[0];
  if (!quiz) fail(404,'Quiz not found');
  await owned(client,owner,quiz.lecture_id,true);
  const result = grade(quiz.questions,answers);
  return (await client.query(
    'INSERT INTO study_attempts(id,owner_key,quiz_id,lecture_id,request_key,answers,feedback,score,total) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
    [randomUUID(),owner,quizId,quiz.lecture_id,key,json(answers),json(result.feedback),result.score,result.total])).rows[0];
});
const attempts = async (user,lectureId) => {
  await owned(db,ownerKey(user),lectureId);
  return (await db.query('SELECT * FROM study_attempts WHERE owner_key=$1 AND lecture_id=$2 ORDER BY created_at DESC LIMIT 20', [ownerKey(user),lectureId])).rows;
};
const removeLecture = (user,id) => db.transaction(async (client) => {
  const owner = ownerKey(user);
  const lecture=await owned(client,owner,id,true);
  await client.query("UPDATE study_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE owner_key=$1 AND lecture_id=$2 AND status IN ('queued','running')", [owner,id]);
  await client.query('DELETE FROM study_attempts WHERE owner_key=$1 AND lecture_id=$2', [owner,id]);
  await client.query('DELETE FROM study_quizzes WHERE owner_key=$1 AND lecture_id=$2', [owner,id]);
  await client.query('DELETE FROM study_messages WHERE owner_key=$1 AND lecture_id=$2', [owner,id]);
  await client.query('DELETE FROM study_jobs WHERE owner_key=$1 AND lecture_id=$2', [owner,id]);
  await client.query('DELETE FROM study_members WHERE owner_key=$1 AND lecture_id=$2', [owner,id]);
  // Shared preparation must survive the initiating student leaving the library.
  // Create a fresh receipt for a remaining member; never expose the old owner's job.
  if(lecture.status!=='ready'&&!(await client.query("SELECT 1 FROM study_jobs WHERE lecture_id=$1 AND kind='prepare' AND status IN ('queued','running')",[id])).rowCount){
    const member=(await client.query('SELECT * FROM study_members WHERE lecture_id=$1 ORDER BY created_at LIMIT 1',[id])).rows[0];
    if(member){
      await insertJob(client,member.owner_key,lecture,'prepare','recovery:'+randomUUID(),{source_key:lecture.source_key,enrollment_id:member.enrollment_id,title:member.title});
      await client.query("UPDATE study_lectures SET status='queued',stage='queued',error=NULL WHERE id=$1",[id]);
    }
  }
});
const retry = (user,jobId) => db.transaction(async (client) => {
  const owner = ownerKey(user);
  await lockOwner(client,owner);
  const saved = (await client.query('SELECT lecture_id FROM study_jobs WHERE id=$1 AND owner_key=$2', [jobId,owner])).rows[0];
  if (!saved) fail(404,'Job not found');
  await owned(client,owner,saved.lecture_id,true);
  const job = (await client.query('SELECT * FROM study_jobs WHERE id=$1 AND owner_key=$2 FOR UPDATE', [jobId,owner])).rows[0];
  if (job.status !== 'failed') fail(409,'Only failed requests can be retried');
  if(job.retry_count>=2)fail(429,'This request has exhausted its retries; check the worker before creating another request');
  await ensureCapacity(client);
  const pending=(await client.query("SELECT COUNT(*)::int n FROM study_jobs WHERE owner_key=$1 AND kind=$2 AND status IN ('queued','running')",[owner,job.kind])).rows[0].n;
  if(pending>=(job.kind==='prepare'?2:3))fail(429,'Wait for your pending requests to finish');
  if ((await client.query("SELECT 1 FROM study_jobs WHERE owner_key=$1 AND lecture_id=$2 AND kind=$3 AND status IN ('queued','running')", [owner,job.lecture_id,job.kind])).rowCount) fail(409,'This lecture already has a pending request');
  await client.query("UPDATE study_jobs SET status='queued',stage='queued',attempts=0,retry_count=retry_count+1,error=NULL,available_at=NOW(),lease_token=NULL,lease_until=NULL WHERE id=$1", [jobId]);
  if (job.kind === 'prepare') await client.query("UPDATE study_lectures SET status='queued',stage='queued',error=NULL WHERE id=$1", [job.lecture_id]);
  return { id: jobId, status:'queued' };
});
const claimJob = (workerId,preferPreparation = false) => db.transaction(async (client) => {
  await client.query('INSERT INTO study_workers(id) VALUES($1) ON CONFLICT(id) DO UPDATE SET heartbeat_at=NOW()', [workerId]);
  await client.query("UPDATE study_jobs SET status='failed',error='The worker stopped after the final attempt. Retry this request.',lease_token=NULL,lease_until=NULL WHERE status='running' AND lease_until<NOW() AND attempts>=3");
  // A visibility lease prevents simultaneous claims. Reclaimed jobs get a new
  // fencing token so a late worker cannot publish over a newer result.
  const result = await client.query(
    "SELECT j.* FROM study_jobs j WHERE ((j.status='queued' AND j.available_at<=NOW()) OR (j.status='running' AND j.lease_until<NOW())) AND j.attempts<3 AND EXISTS(SELECT 1 FROM study_members m WHERE m.owner_key=j.owner_key AND m.lecture_id=j.lecture_id) ORDER BY CASE WHEN j.kind='prepare' THEN $1 ELSE $2 END,j.created_at FOR UPDATE SKIP LOCKED LIMIT 1",
    preferPreparation ? [0,1] : [1,0]);
  if (!result.rowCount) return null;
  const job = result.rows[0];
  return (await client.query(
    "UPDATE study_jobs SET status='running',attempts=attempts+1,lease_token=$2,lease_until=NOW()+INTERVAL '5 minutes',updated_at=NOW() WHERE id=$1 RETURNING *",
    [job.id,randomUUID()])).rows[0];
});
const renewLease = (job,workerId) => db.transaction(async (client) => {
  await client.query('UPDATE study_workers SET heartbeat_at=NOW() WHERE id=$1', [workerId]);
  return (await client.query("UPDATE study_jobs SET lease_until=NOW()+INTERVAL '5 minutes' WHERE id=$1 AND lease_token=$2 AND status='running'", [job.id,job.lease_token])).rowCount > 0;
});
const workerContext = async (job) => {
  const lecture = await owned(db,job.owner_key,job.lecture_id);
  if (lecture.version !== job.version) fail(409,'Lecture content has changed');
  const chunks = (await db.query('SELECT * FROM study_chunks WHERE lecture_id=$1 AND version=$2 ORDER BY ordinal', [lecture.id,job.version])).rows;
  const history = (await db.query(
    "SELECT question,answer FROM study_messages WHERE owner_key=$1 AND lecture_id=$2 AND version=$3 AND answer IS NOT NULL AND created_at>NOW()-INTERVAL '90 days' ORDER BY created_at DESC LIMIT 5",
    [job.owner_key,lecture.id,job.version])).rows.reverse();
  return { lecture,chunks,history,payload:job.payload,kind:job.kind };
};
const checkpoint = (job,stage,values = {}) => db.transaction(async (client) => {
  await owned(client,job.owner_key,job.lecture_id,true);
  const current = (await client.query("SELECT * FROM study_jobs WHERE id=$1 AND lease_token=$2 AND status='running' FOR UPDATE", [job.id,job.lease_token])).rows[0];
  if (!current) fail(409,'Worker lease lost');
  await client.query('UPDATE study_jobs SET stage=$3,updated_at=NOW() WHERE id=$1 AND lease_token=$2', [job.id,job.lease_token,stage]);
  if (job.kind === 'prepare') await client.query(
    "UPDATE study_lectures SET status='processing',stage=$2,provider_job_id=COALESCE($3,provider_job_id),transcript=COALESCE($4,transcript),raw_transcript=COALESCE($5,raw_transcript),updated_at=NOW() WHERE id=$1",
    [job.lecture_id,stage,values.provider_job_id || null,values.transcript || null,values.raw_transcript || null]);
});
const preparationProgress = (job,progress) => db.transaction(async(client)=>{
  await owned(client,job.owner_key,job.lecture_id,true);
  if(!(await client.query("SELECT 1 FROM study_jobs WHERE id=$1 AND lease_token=$2 AND status='running' FOR UPDATE",[job.id,job.lease_token])).rowCount)fail(409,'Worker lease lost');
  if(progress.chunks){
    await client.query('DELETE FROM study_chunks WHERE lecture_id=$1 AND version=$2',[job.lecture_id,job.version]);
    for(const chunk of progress.chunks)await client.query(
      'INSERT INTO study_chunks(lecture_id,version,id,text,section,ordinal,embedding,embedding_model) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [job.lecture_id,job.version,chunk.id,chunk.text,chunk.section,chunk.ordinal,chunk.embedding||null,chunk.embedding_model||null]);
  }
  if(progress.sections)await client.query('UPDATE study_lectures SET sections=$2,updated_at=NOW() WHERE id=$1',[job.lecture_id,json(progress.sections)]);
});
const complete = (job,result) => db.transaction(async (client) => {
  const lecture = await owned(client,job.owner_key,job.lecture_id,true);
  const current = (await client.query("SELECT * FROM study_jobs WHERE id=$1 AND lease_token=$2 AND status='running' FOR UPDATE", [job.id,job.lease_token])).rows[0];
  if (!current) fail(409,'Worker lease lost');
  if (lecture.version !== job.version) fail(409,'Lecture content has changed');
  if(job.kind==='prepare')contracts.preparation(result);
  else {
    const chunks=(await client.query('SELECT id FROM study_chunks WHERE lecture_id=$1 AND version=$2'+
      (job.kind==='quiz'&&job.payload.section?' AND section=$3':''),job.kind==='quiz'&&job.payload.section?
        [lecture.id,job.version,job.payload.section]:[lecture.id,job.version])).rows;
    contracts.generated(job.kind,result,chunks,job.payload);
  }
  if (job.kind === 'prepare') {
    await client.query('DELETE FROM study_chunks WHERE lecture_id=$1 AND version=$2', [lecture.id,job.version]);
    for (const chunk of result.chunks) await client.query(
      'INSERT INTO study_chunks(lecture_id,version,id,text,section,ordinal,embedding,embedding_model) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [lecture.id,job.version,chunk.id,chunk.text,chunk.section,chunk.ordinal,chunk.embedding || null,chunk.embedding_model || null]);
    await client.query("UPDATE study_lectures SET status='ready',stage='ready',summary=$2,sections=$3,concepts=$4,error=NULL,updated_at=NOW() WHERE id=$1",
      [lecture.id,result.summary,json(result.sections),json(result.concepts)]);
    result = { lecture_id:lecture.id };
  } else if (job.kind === 'chat') {
    await client.query('UPDATE study_messages SET answer=$2,citations=$3 WHERE job_id=$1 AND owner_key=$4', [job.id,result.answer,json(result.citations),job.owner_key]);
  } else {
    await client.query('INSERT INTO study_quizzes(id,owner_key,lecture_id,version,questions) VALUES($1,$2,$3,$4,$5)',
      [job.id,job.owner_key,lecture.id,job.version,json(result.questions)]);
    result = { quiz_id:job.id };
  }
  await client.query("UPDATE study_jobs SET status='completed',stage='completed',result=$3,lease_until=NULL,lease_token=NULL,error=NULL,updated_at=NOW() WHERE id=$1 AND lease_token=$2",
    [job.id,job.lease_token,json(result)]);
});
const failJob = (job,message) => db.transaction(async (client) => {
  if (!(await client.query('SELECT 1 FROM study_members WHERE owner_key=$1 AND lecture_id=$2',[job.owner_key,job.lecture_id])).rowCount) return;
  await owned(client,job.owner_key,job.lecture_id,true);
  const status = job.attempts >= 3 ? 'failed' : 'queued';
  const changed = await client.query(
    "UPDATE study_jobs SET status=$3,error=$4,lease_token=NULL,lease_until=NULL,available_at=NOW()+($5 * INTERVAL '1 second'),updated_at=NOW() WHERE id=$1 AND lease_token=$2 AND status='running'",
    [job.id,job.lease_token,status,message,job.attempts === 1 ? 30 : 120]);
  if (changed.rowCount && job.kind === 'prepare') await client.query('UPDATE study_lectures SET status=$2,error=$3,stage=$2,updated_at=NOW() WHERE id=$1', [job.lecture_id,status,message]);
});
const status = async () => {
  await db.query('SELECT 1 FROM study_schema_migrations LIMIT 1');
  const workers = await db.query("SELECT EXISTS(SELECT 1 FROM study_workers WHERE heartbeat_at>NOW()-INTERVAL '90 seconds') AS online");
  const bytes = Number((await db.query('SELECT pg_database_size(current_database())::float AS bytes')).rows[0].bytes);
  return { enabled:true,worker_online:workers.rows[0].online,storage_warning:bytes >= Number(process.env.LECTURE_STUDY_MAX_DB_MB || 500)*1024*1024*0.7 };
};
const clearMessages = (user,id) => db.transaction(async(client)=>{
  const owner=ownerKey(user);
  await owned(client,owner,id,true);
  await client.query("UPDATE study_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE owner_key=$1 AND lecture_id=$2 AND kind='chat' AND status IN ('queued','running')",[owner,id]);
  await client.query('DELETE FROM study_messages WHERE owner_key=$1 AND lecture_id=$2',[owner,id]);
  await client.query("DELETE FROM study_jobs WHERE owner_key=$1 AND lecture_id=$2 AND kind='chat'",[owner,id]);
});
module.exports = { createLecture,preparationReplay,listLectures,getLecture,enqueue,getJob,messages,quizzes,getQuiz,submitAttempt,attempts,
  removeLecture,clearMessages,retry,claimJob,renewLease,workerContext,checkpoint,preparationProgress,complete,failJob,status };
