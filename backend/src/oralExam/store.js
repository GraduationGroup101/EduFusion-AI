const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const db = require('../db');
const { ownerKey } = require('../lib/owner');
const { fail } = require('./contracts');
const {policy,evaluateCore,classified}=require('./grading');
const {classifyNext}=require('./progression');
const {closing}=require('./conversation');
const TABLE='edufusion_oral_exam_sessions';
const TURNS='edufusion_oral_exam_turns';
const expire = async (client=db) => client.query(`UPDATE ${TABLE} SET status='timed_out',ended_at=expires_at,termination_reason='time_limit',lease_token=NULL,lease_until=NULL,lease_client_id=NULL,lease_client_attempt=NULL,updated_at=clock_timestamp() WHERE status='active' AND expires_at<=clock_timestamp()`);
async function create(user,material,language,key) {
  return db.transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`oral:${ownerKey(user)}`]);
    const previous=(await client.query(`SELECT * FROM ${TABLE} WHERE owner_key=$1 AND request_key=$2`,[ownerKey(user),key])).rows[0];
    if(previous) {
      if(!isDeepStrictEqual(previous.source,material.source)||previous.language!==language) fail(409,'This request key belongs to different material');
      return previous;
    }
    const count=(await client.query(`SELECT COUNT(*)::int n FROM ${TABLE} WHERE owner_key=$1 AND created_at>NOW()-INTERVAL '1 day'`,[ownerKey(user)])).rows[0].n;
    if(count>=12) fail(429,'Daily oral exam limit reached. Please return tomorrow.');
    return (await client.query(`INSERT INTO ${TABLE}(id,owner_key,id_student,user_id,request_key,source,material_title,context,language) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [randomUUID(),ownerKey(user),user.id_student??null,user.id_student==null?user.id:null,key,material.source,material.title,{...material.context,oral_policy:policy()},language])).rows[0];
  });
}
async function get(user,id) {
  await expire();
  const row=(await db.query(`SELECT *,clock_timestamp() AS server_now FROM ${TABLE} WHERE id=$1 AND owner_key=$2`,[id,ownerKey(user)])).rows[0];
  if(!row) fail(404,'Exam not found');
  row.turns=(await db.query(`SELECT * FROM ${TURNS} WHERE session_id=$1 ORDER BY sequence`,[id])).rows;
  return row;
}
async function list(user) {
  await expire();
  return (await db.query(`SELECT id,material_title,status,created_at,expires_at,evaluation_status FROM ${TABLE} WHERE owner_key=$1 ORDER BY created_at DESC LIMIT 30`,[ownerKey(user)])).rows;
}
async function start(user,id) {
  return db.transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`oral:${ownerKey(user)}`]);
    await expire(client);
    const row=(await client.query(`SELECT * FROM ${TABLE} WHERE id=$1 AND owner_key=$2 FOR UPDATE`,[id,ownerKey(user)])).rows[0];
    if(!row) fail(404,'Exam not found');
    if(row.status==='active') return row;
    if(row.status!=='ready') fail(409,'This exam has ended. Start a new exam.');
    const active=await client.query(`SELECT id FROM ${TABLE} WHERE owner_key=$1 AND status='active'`,[ownerKey(user)]);
    if(active.rowCount) fail(409,'You already have an active exam. Resume or end it first.');
    return (await client.query(`UPDATE ${TABLE} SET status='active',started_at=NOW(),expires_at=NOW()+INTERVAL '10 minutes',updated_at=NOW() WHERE id=$1 RETURNING *`,[id])).rows[0];
  });
}
async function claim(user,id,clientId=null,attempt=null) {
  await expire();
  const token=randomUUID();
  // The private browser capability survives retries, including a lost welcome.
  // The separate write token rotates atomically to fence the previous socket.
  // Attempts from one capability are ordered: only a strictly newer attempt may
  // reclaim, and an older or repeated attempt is refused even when the lease is
  // free, so a delayed handshake can never replace a newer owner.
  const row=(await db.query(`UPDATE ${TABLE} SET lease_token=$3,lease_client_id=$4,lease_client_attempt=$5,lease_until=clock_timestamp()+INTERVAL '20 seconds'
    WHERE id=$1 AND owner_key=$2 AND status='active' AND expires_at>clock_timestamp() AND (
      ($4::uuid IS NOT NULL AND lease_client_id=$4 AND $5::integer>COALESCE(lease_client_attempt,0))
      OR ((lease_until IS NULL OR lease_until<clock_timestamp()) AND ($4::uuid IS NULL OR lease_client_id IS DISTINCT FROM $4))
    ) RETURNING *`,[id,ownerKey(user),token,clientId,clientId?attempt:null])).rows[0];
  if(!row) fail(409,'Exam is ended or connected in another tab. Retry in a moment.');
  return {row,token};
}
async function renew(id,token) {
  const row=(await db.query(`UPDATE ${TABLE} SET lease_until=clock_timestamp()+INTERVAL '20 seconds' WHERE id=$1 AND lease_token=$2 AND status='active' AND expires_at>clock_timestamp() AND lease_until>clock_timestamp() RETURNING *,clock_timestamp() AS server_now`,[id,token])).rows[0];
  return row;
}
// The capability and its newest attempt are kept after release so a late,
// older handshake from the same browser cannot claim the freed lease.
const release=(id,token)=>db.query(`UPDATE ${TABLE} SET lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2`,[id,token]);
async function recordAnswer(id,token,sequence,transcript) {
  return db.transaction(async client=>{
    const valid=await client.query(`SELECT id FROM ${TABLE} WHERE id=$1 AND lease_token=$2 AND status='active' AND expires_at>clock_timestamp() AND lease_until>clock_timestamp() FOR UPDATE`,[id,token]);
    if(!valid.rowCount)fail(409,'Exam connection expired');
    const row=(await client.query(`SELECT * FROM ${TURNS} WHERE session_id=$1 AND sequence=$2`,[id,sequence])).rows[0];
    if(!row||row.assessment||(row.transcript!==null&&row.transcript!==transcript))fail(409,'This answer is already saved');
    await client.query(`UPDATE ${TURNS} SET transcript=$3,answered_at=COALESCE(answered_at,clock_timestamp()) WHERE session_id=$1 AND sequence=$2`,[id,sequence,transcript]);
  });
}
// A conversational exchange (repeat, clarification, nudge, retry) belongs to
// the current question. It is appended to that turn and never creates a turn,
// a transcript or an assessment. A transcript recorded provisionally before
// the intent was known is cleared so it cannot be scored later.
async function recordExchange(id,token,sequence,exchange) {
  return db.transaction(async client=>{
    const valid=await client.query(`SELECT id FROM ${TABLE} WHERE id=$1 AND lease_token=$2 AND status='active' AND expires_at>clock_timestamp() AND lease_until>clock_timestamp() FOR UPDATE`,[id,token]);
    if(!valid.rowCount)fail(409,'Exam connection expired');
    const row=(await client.query(`SELECT * FROM ${TURNS} WHERE session_id=$1 AND sequence=$2`,[id,sequence])).rows[0];
    if(!row||row.assessment)fail(409,'This question is already answered');
    const entry={kind:String(exchange.kind),transcript:exchange.transcript==null?null:String(exchange.transcript).slice(0,8000),reply:String(exchange.reply||'').slice(0,1200),at:new Date().toISOString()};
    await client.query(`UPDATE ${TURNS} SET transcript=NULL,answered_at=NULL,exchanges=COALESCE(exchanges,'[]'::jsonb)||$3::jsonb WHERE session_id=$1 AND sequence=$2`,[id,sequence,JSON.stringify([entry])]);
    return entry;
  });
}
async function commit(id,token,expectedSequence,transcript,decision) {
  return db.transaction(async client=>{
    const session=(await client.query(`SELECT *,clock_timestamp() AS server_now FROM ${TABLE} WHERE id=$1 AND lease_token=$2 AND status='active' AND expires_at>clock_timestamp() AND lease_until>clock_timestamp() FOR UPDATE`,[id,token])).rows[0];
    if(!session) fail(409,'Exam connection expired');
    const turns=(await client.query(`SELECT * FROM ${TURNS} WHERE session_id=$1 ORDER BY sequence`,[id])).rows;
    const last=turns.at(-1);
    if((last?.sequence||0)!==expectedSequence) fail(409,'The exam has already advanced');
    if(last && transcript!==null) {
      // An answer is only committed with its assessment; a control decision
      // (repeat, clarify, don't know) must never end or advance the exam here.
      if(!decision.assessment||(decision.intent&&decision.intent!=='answer')) fail(409,'An answer must be assessed before it is saved');
      if(last.assessment||(last.transcript!==null&&last.transcript!==transcript)) fail(409,'This answer is already saved');
      await client.query(`UPDATE ${TURNS} SET transcript=$2,assessment=$3,answered_at=COALESCE(answered_at,clock_timestamp()) WHERE id=$1`,[last.id,transcript,decision.assessment]);
    } else if(last) fail(409,'Answer the current question first');
    if(!turns.length&&decision.core_concepts?.length){
      session.context={...session.context,core_plan:decision.core_concepts};
      await client.query(`UPDATE ${TABLE} SET context=$2 WHERE id=$1`,[id,session.context]);
    }
    const q=classifyNext({...session,turns},decision.next,(new Date(session.expires_at)-new Date(session.server_now))/1000);
    if(q) {
      await client.query(`INSERT INTO ${TURNS}(id,session_id,sequence,question,concept,question_type,difficulty,citations,follow_up_reason,category,concept_key,parent_sequence,transition) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [randomUUID(),id,expectedSequence+1,q.question,q.concept,q.question_type,q.difficulty,JSON.stringify(q.citations),q.follow_up_reason,q.category,q.concept_key,q.parent_sequence,decision.transition||null]);
    } else if(transcript!==null) {
      await client.query(`UPDATE ${TABLE} SET status='completed',ended_at=LEAST(clock_timestamp(),expires_at),termination_reason='exam_completed',lease_token=NULL,lease_until=NULL,lease_client_id=NULL,lease_client_attempt=NULL,updated_at=clock_timestamp() WHERE id=$1`,[id]);
    }
  });
}
async function finish(user,id,reason='student_ended',token=null) {
  await expire();
  await db.query(`UPDATE ${TABLE} SET status=CASE WHEN status='ready' THEN 'aborted' ELSE 'completed' END,ended_at=CASE WHEN expires_at IS NULL THEN clock_timestamp() ELSE LEAST(clock_timestamp(),expires_at) END,termination_reason=$3,lease_token=NULL,lease_until=NULL,lease_client_id=NULL,lease_client_attempt=NULL,updated_at=clock_timestamp() WHERE id=$1 AND owner_key=$2 AND status IN ('ready','active') AND ($4::uuid IS NULL OR lease_token=$4)`,[id,ownerKey(user),reason,token]);
  return get(user,id);
}
async function saveEvaluation(id,evaluation) {
  await db.query(`UPDATE ${TABLE} SET evaluation=$2,evaluation_status='ready',evaluation_error=NULL,evaluation_attempts=evaluation_attempts+1,updated_at=clock_timestamp() WHERE id=$1 AND status NOT IN ('ready','active') AND evaluation_status<>'ready'`,[id,evaluation]);
}
async function ensureCore(user,id){
  const session=await get(user,id);
  if(['ready','active'].includes(session.status))return session;
  if(!session.core_evaluation){
    const core=evaluateCore(session);
    await db.query(`UPDATE ${TABLE} SET core_evaluation=$2 WHERE id=$1 AND core_evaluation IS NULL AND status NOT IN ('ready','active')`,[id,core]);
    return get(user,id);
  }
  return session;
}
async function claimFeedback(id){
  const token=randomUUID();
  const result=await db.query(`UPDATE ${TABLE} SET feedback_token=$2,feedback_until=clock_timestamp()+INTERVAL '150 seconds',evaluation_status='pending',evaluation_error=NULL WHERE id=$1 AND status NOT IN ('ready','active') AND evaluation_status<>'ready' AND (feedback_until IS NULL OR feedback_until<clock_timestamp()) RETURNING id`,[id,token]);
  return result.rowCount?token:null;
}
const completeFeedback=(id,token,report,error=null)=>db.query(`UPDATE ${TABLE} SET evaluation=CASE WHEN $3::jsonb IS NULL THEN evaluation ELSE $3::jsonb END,evaluation_status=$4,evaluation_error=$5,evaluation_attempts=evaluation_attempts+1,feedback_token=NULL,feedback_until=NULL WHERE id=$1 AND feedback_token=$2`,[id,token,report,error?'failed':'ready',error]);
const interruption=(id,token,kind)=>db.query(`UPDATE ${TABLE} SET technical_interruptions=technical_interruptions||$3::jsonb WHERE id=$1 AND lease_token=$2 AND status='active' AND jsonb_array_length(technical_interruptions)<20`,[id,token,JSON.stringify([{kind,at:new Date().toISOString()}])]);
// Records why the last attempt failed (a safe code, never provider text) so a
// retry can explain it; a ready report is never downgraded.
const evaluationFailed=(id,code='unknown')=>db.query(`UPDATE ${TABLE} SET evaluation_status='failed',evaluation_error=$2,evaluation_attempts=evaluation_attempts+1,updated_at=clock_timestamp() WHERE id=$1 AND evaluation_status<>'ready'`,[id,String(code).slice(0,80)]);
function publicView(row) {
  const {id,material_title,language,status,started_at,expires_at,ended_at,termination_reason,evaluation,evaluation_status,evaluation_error,evaluation_attempts,server_now}=row;
  // Only the material reference is exposed (never pasted text) so results can link back to lecture tools.
  const source=row.source&&row.source.kind!=='text'?{kind:row.source.kind,id:row.source.id}:undefined;
  const terminal=!['ready','active'].includes(status);
  const feedbackExpired=evaluation_status==='pending'&&row.feedback_until&&new Date(row.feedback_until)<=new Date(server_now||Date.now());
  const core=terminal?(row.core_evaluation||evaluateCore(row)):null;
  const report=core?{...core,commentary:evaluation_status==='ready'&&evaluation?{summary:evaluation.summary,strengths:evaluation.strengths,areasForImprovement:evaluation.areasForImprovement}:null}:null;
  return {id,material_title,language,status,started_at,expires_at,ended_at,termination_reason,closing_message:terminal?closing(language):null,evaluation:report,evaluation_status:feedbackExpired?'failed':evaluation_status,evaluation_error:feedbackExpired?'timeout':evaluation_error??null,evaluation_attempts:evaluation_attempts??0,server_now:server_now||new Date(),source,
    turns:classified(row.turns||[]).map(({id,sequence,question,concept,transcript,assessment,exchanges,category,concept_key,parent_sequence,transition})=>({id,sequence,question,concept,transcript,category,concept_key,parent_sequence,transition,feedback:terminal?assessment?.feedback:undefined,
      exchanges:(exchanges||[]).map(({kind,transcript,reply,at})=>({kind,transcript,reply,at}))}))||[]};
}
module.exports={create,get,list,start,claim,renew,release,recordAnswer,recordExchange,commit,finish,expire,saveEvaluation,evaluationFailed,publicView,ensureCore,claimFeedback,completeFeedback,interruption};
