const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const db = require('../db');
const { ownerKey } = require('../lib/owner');
const { fail } = require('./contracts');
const TABLE='edufusion_oral_exam_sessions';
const TURNS='edufusion_oral_exam_turns';
const expire = async (client=db) => client.query(`UPDATE ${TABLE} SET status='timed_out',ended_at=expires_at,termination_reason='time_limit',lease_token=NULL,lease_until=NULL,lease_client_id=NULL,updated_at=clock_timestamp() WHERE status='active' AND expires_at<=clock_timestamp()`);
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
      [randomUUID(),ownerKey(user),user.id_student??null,user.id_student==null?user.id:null,key,material.source,material.title,material.context,language])).rows[0];
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
async function claim(user,id,clientId=null) {
  await expire();
  const token=randomUUID();
  // The private browser capability survives retries, including a lost welcome.
  // The separate write token rotates atomically to fence the previous socket.
  const row=(await db.query(`UPDATE ${TABLE} SET lease_token=$3,lease_client_id=$4,lease_until=clock_timestamp()+INTERVAL '20 seconds' WHERE id=$1 AND owner_key=$2 AND status='active' AND expires_at>clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp() OR lease_client_id=$4) RETURNING *`,[id,ownerKey(user),token,clientId])).rows[0];
  if(!row) fail(409,'Exam is ended or connected in another tab. Retry in a moment.');
  return {row,token};
}
async function renew(id,token) {
  const row=(await db.query(`UPDATE ${TABLE} SET lease_until=clock_timestamp()+INTERVAL '20 seconds' WHERE id=$1 AND lease_token=$2 AND status='active' AND expires_at>clock_timestamp() AND lease_until>clock_timestamp() RETURNING *,clock_timestamp() AS server_now`,[id,token])).rows[0];
  return row;
}
const release=(id,token)=>db.query(`UPDATE ${TABLE} SET lease_token=NULL,lease_until=NULL,lease_client_id=NULL WHERE id=$1 AND lease_token=$2`,[id,token]);
async function recordAnswer(id,token,sequence,transcript) {
  return db.transaction(async client=>{
    const valid=await client.query(`SELECT id FROM ${TABLE} WHERE id=$1 AND lease_token=$2 AND status='active' AND expires_at>clock_timestamp() AND lease_until>clock_timestamp() FOR UPDATE`,[id,token]);
    if(!valid.rowCount)fail(409,'Exam connection expired');
    const row=(await client.query(`SELECT * FROM ${TURNS} WHERE session_id=$1 AND sequence=$2`,[id,sequence])).rows[0];
    if(!row||row.assessment||(row.transcript!==null&&row.transcript!==transcript))fail(409,'This answer is already saved');
    await client.query(`UPDATE ${TURNS} SET transcript=$3,answered_at=COALESCE(answered_at,clock_timestamp()) WHERE session_id=$1 AND sequence=$2`,[id,sequence,transcript]);
  });
}
async function commit(id,token,expectedSequence,transcript,decision) {
  return db.transaction(async client=>{
    const session=(await client.query(`SELECT * FROM ${TABLE} WHERE id=$1 AND lease_token=$2 AND status='active' AND expires_at>clock_timestamp() AND lease_until>clock_timestamp() FOR UPDATE`,[id,token])).rows[0];
    if(!session) fail(409,'Exam connection expired');
    const turns=(await client.query(`SELECT * FROM ${TURNS} WHERE session_id=$1 ORDER BY sequence`,[id])).rows;
    const last=turns.at(-1);
    if((last?.sequence||0)!==expectedSequence) fail(409,'The exam has already advanced');
    if(last && transcript!==null) {
      if(last.assessment||(last.transcript!==null&&last.transcript!==transcript)) fail(409,'This answer is already saved');
      await client.query(`UPDATE ${TURNS} SET transcript=$2,assessment=$3,answered_at=COALESCE(answered_at,clock_timestamp()) WHERE id=$1`,[last.id,transcript,decision.assessment]);
    } else if(last) fail(409,'Answer the current question first');
    if(decision.next) {
      const q=decision.next;
      await client.query(`INSERT INTO ${TURNS}(id,session_id,sequence,question,concept,question_type,difficulty,citations,follow_up_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [randomUUID(),id,expectedSequence+1,q.question,q.concept,q.question_type,q.difficulty,JSON.stringify(q.citations),q.follow_up_reason]);
    } else if(transcript!==null) {
      await client.query(`UPDATE ${TABLE} SET status='completed',ended_at=LEAST(clock_timestamp(),expires_at),termination_reason='exam_completed',lease_token=NULL,lease_until=NULL,lease_client_id=NULL,updated_at=clock_timestamp() WHERE id=$1`,[id]);
    }
  });
}
async function finish(user,id,reason='student_ended',token=null) {
  await expire();
  await db.query(`UPDATE ${TABLE} SET status=CASE WHEN status='ready' THEN 'aborted' ELSE 'completed' END,ended_at=CASE WHEN expires_at IS NULL THEN clock_timestamp() ELSE LEAST(clock_timestamp(),expires_at) END,termination_reason=$3,lease_token=NULL,lease_until=NULL,lease_client_id=NULL,updated_at=clock_timestamp() WHERE id=$1 AND owner_key=$2 AND status IN ('ready','active') AND ($4::uuid IS NULL OR lease_token=$4)`,[id,ownerKey(user),reason,token]);
  return get(user,id);
}
async function saveEvaluation(id,evaluation) {
  await db.query(`UPDATE ${TABLE} SET evaluation=$2,evaluation_status='ready',updated_at=clock_timestamp() WHERE id=$1 AND status NOT IN ('ready','active') AND evaluation_status<>'ready'`,[id,evaluation]);
}
const evaluationFailed=id=>db.query(`UPDATE ${TABLE} SET evaluation_status='failed' WHERE id=$1 AND evaluation_status<>'ready'`,[id]);
function publicView(row) {
  const {id,material_title,language,status,started_at,expires_at,ended_at,termination_reason,evaluation,evaluation_status,server_now}=row;
  // Only the material reference is exposed (never pasted text) so results can link back to lecture tools.
  const source=row.source&&row.source.kind!=='text'?{kind:row.source.kind,id:row.source.id}:undefined;
  return {id,material_title,language,status,started_at,expires_at,ended_at,termination_reason,evaluation,evaluation_status,server_now:server_now||new Date(),source,
    turns:row.turns?.map(({id,sequence,question,concept,transcript,assessment})=>({id,sequence,question,concept,transcript,feedback:assessment?.feedback}))||[]};
}
module.exports={create,get,list,start,claim,renew,release,recordAnswer,commit,finish,expire,saveEvaluation,evaluationFailed,publicView};
