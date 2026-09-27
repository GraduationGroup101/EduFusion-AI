require('dotenv').config();
const db = require('../src/lectureStudy/database');
const cleanup = () => db.transaction(async (client) => {
  await client.query("DELETE FROM study_messages WHERE created_at<NOW()-INTERVAL '90 days'");
  await client.query("DELETE FROM study_jobs WHERE kind='chat' AND status IN ('completed','failed','cancelled') AND created_at<NOW()-INTERVAL '90 days' AND NOT EXISTS(SELECT 1 FROM study_messages m WHERE m.job_id=study_jobs.id)");
  await client.query("DELETE FROM study_usage WHERE day<(NOW() AT TIME ZONE 'UTC')::date-90");
  await client.query("UPDATE study_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE status IN ('queued','running') AND NOT EXISTS(SELECT 1 FROM study_members m WHERE m.owner_key=study_jobs.owner_key AND m.lecture_id=study_jobs.lecture_id)");
  const orphaned = (await client.query("SELECT id FROM study_lectures l WHERE updated_at<NOW()-INTERVAL '30 days' AND NOT EXISTS(SELECT 1 FROM study_members m WHERE m.lecture_id=l.id) FOR UPDATE")).rows;
  for (const {id} of orphaned) {
    await client.query('DELETE FROM study_attempts WHERE lecture_id=$1',[id]);
    await client.query('DELETE FROM study_quizzes WHERE lecture_id=$1',[id]);
    await client.query('DELETE FROM study_messages WHERE lecture_id=$1',[id]);
    await client.query('DELETE FROM study_jobs WHERE lecture_id=$1',[id]);
    await client.query('DELETE FROM study_lectures WHERE id=$1',[id]);
  }
  await client.query("DELETE FROM study_workers WHERE heartbeat_at<NOW()-INTERVAL '7 days'");
});
if (require.main === module) cleanup().catch((error) => {
  console.error('Learning cleanup failed:',error.code || error.name);process.exitCode=1;
}).finally(db.close);
module.exports = { cleanup };
