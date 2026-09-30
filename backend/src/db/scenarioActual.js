const {createHash}=require('node:crypto');
const db=require('./index');
const {getStudentBehaviorData}=require('./queries');
const {scenario:validateScenario}=require('../lib/validation');

const conflict=()=>{throw Object.assign(new Error('The scenario or academic records changed. Save and evaluate the scenario again.'),{statusCode:409});};
// Include all model evidence, not only the summary displayed in the UI.
async function evidence(id,query=db.readQuery) {
  const enrollment=(await query('SELECT * FROM enrollments WHERE id=$1',[id])).rows[0];
  if(!enrollment)return null;
  const cp=enrollment.course_presentation_id;
  const snapshot={enrollment};
  for(const [name,sql,params] of [
    ['clock','SELECT current_day,max_day FROM academic_clocks WHERE course_presentation_id=$1',[cp]],
    ['course','SELECT * FROM course_presentations WHERE id=$1',[cp]],
    ['sites','SELECT * FROM vle_sites WHERE course_presentation_id=$1 ORDER BY id_site',[cp]],
    ['assessments','SELECT * FROM assessments WHERE course_presentation_id=$1 ORDER BY id_assessment',[cp]],
    ['activity','SELECT * FROM student_vle_events WHERE enrollment_id=$1 ORDER BY id',[id]],
    ['submissions','SELECT * FROM student_assessments WHERE enrollment_id=$1 ORDER BY id',[id]],
  ])snapshot[name]=(await query(sql,params)).rows;
  return {snapshot,hash:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')};
}
function validatePrediction(value) {
  if(!value||!Number.isFinite(value.risk_probability)||value.risk_probability<0||value.risk_probability>1||
    !['LOW','MEDIUM','HIGH'].includes(value.risk_level)||![0,1,true,false].includes(value.at_risk)) {
    throw Object.assign(new Error('Invalid prediction result'),{statusCode:502});
  }
  return value;
}
// The model result is already saved on the isolated scenario, with the exact
// evidence fingerprint used to evaluate it. Apply only that reviewed version.
async function applyActual(idStudent,id,revision) {
  return db.transaction(async client=>{
    const query=(sql,params)=>client.query(sql,params);
    await query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    const owned=(await query('SELECT * FROM enrollments WHERE id=$1 AND id_student=$2 FOR UPDATE',[id,idStudent])).rows[0];
    if(!owned)return null;
    const saved=(await query('SELECT data FROM edufusion_student_scenarios WHERE id_student=$1 AND enrollment_id=$2 FOR UPDATE',[idStudent,id])).rows[0]?.data;
    if(!saved||!revision||saved.revision!==revision)conflict();
    if(saved.applied_at)return {scenario:saved,already_applied:true};
    if(!saved.prediction_available||!saved.prediction_evidence_hash)conflict();
    const prediction=validatePrediction(saved.prediction);
    const cp=owned.course_presentation_id;
    await query('SELECT id FROM academic_clocks WHERE course_presentation_id=$1 FOR SHARE',[cp]);
    await query('SELECT id FROM student_assessments WHERE enrollment_id=$1 FOR UPDATE',[id]);
    await query('SELECT id FROM student_vle_events WHERE enrollment_id=$1 FOR UPDATE',[id]);
    const before=await evidence(id,query);
    if(before.hash!==saved.prediction_evidence_hash)conflict();
    const course=(await getStudentBehaviorData(idStudent,query)).find(row=>Number(row.enrollment_id)===id);
    if(!course||Number(course.current_day)!==saved.based_on_day)conflict();
    const values=validateScenario(saved.inputs);
    for(const [field,type] of [['quiz_clicks','quiz'],['forum_clicks','forumng'],['resource_clicks','resource']]) {
      if(!values[field])continue;
      const site=before.snapshot.sites.find(row=>row.activity_type===type);
      if(!site)throw Object.assign(new Error(`This course has no ${type} activity to apply.`),{statusCode:409});
      for(const event of saved.activity[field])await query('INSERT INTO student_vle_events(enrollment_id,id_site,date,sum_click) VALUES($1,$2,$3,$4)',[id,site.id_site,event.date,event.clicks]);
    }
    for(const type of ['tma','cma']) {
      const score=values[`latest_${type}_score`],delay=values[`${type}_delay_days`];
      if(score===undefined&&delay===undefined)continue;
      const assessmentId=course[`latest_${type}_id`];
      if(!assessmentId)conflict();
      const date=delay===undefined?course[`latest_${type}_date_submitted`]:Number(course[`latest_${type}_due_date`])+delay;
      if(date>course.current_day)conflict();
      await query('UPDATE student_assessments SET score=$3,date_submitted=$4 WHERE id=$1 AND enrollment_id=$2',[assessmentId,id,score??course[`latest_${type}_score`],date]);
    }
    if(values.new_submission_score!==undefined) {
      const type=(values.new_submission_type||'TMA').toLowerCase();
      const assessmentId=course[`next_${type}_assessment_id`],due=course[`next_${type}_due_date`];
      const date=Number(due)+(values.new_submission_delay_days||0);
      if(!assessmentId||due==null||date>course.current_day)conflict();
      await query('INSERT INTO student_assessments(enrollment_id,id_assessment,date_submitted,score) VALUES($1,$2,$3,$4)',[id,assessmentId,date,values.new_submission_score]);
    }
    // Existing deployments have a unique enrollment/day constraint; fresh test
    // databases do not. UPDATE then INSERT supports both without schema drift.
    const prior=(await query('SELECT * FROM predictions WHERE enrollment_id=$1 AND day_of_course=$2 FOR UPDATE',[id,saved.based_on_day])).rows;
    const params=[id,saved.based_on_day,prediction.risk_probability,prediction.risk_level,Boolean(prediction.at_risk),prediction.threshold_used??null,prediction.recommended_action??null,JSON.stringify(prediction.explanation||[]),JSON.stringify(prediction.model_confidence??null),JSON.stringify(prediction.data_completeness??null)];
    const updated=await query('UPDATE predictions SET risk_probability=$3,risk_level=$4,at_risk=$5,threshold_used=$6,recommended_action=$7,explanation=$8,model_confidence=$9,data_completeness=$10,created_at=clock_timestamp() WHERE enrollment_id=$1 AND day_of_course=$2',params);
    if(!updated.rowCount)await query('INSERT INTO predictions(enrollment_id,day_of_course,risk_probability,risk_level,at_risk,threshold_used,recommended_action,explanation,model_confidence,data_completeness) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',params);
    const data={...saved,applied_at:new Date().toISOString()};
    await query('INSERT INTO edufusion_scenario_applications(revision,id_student,enrollment_id,before_data,scenario) VALUES($1,$2,$3,$4,$5)',[revision,idStudent,id,JSON.stringify({...before.snapshot,predictions:prior}),JSON.stringify(data)]);
    await query('UPDATE edufusion_student_scenarios SET data=$3 WHERE id_student=$1 AND enrollment_id=$2',[idStudent,id,JSON.stringify(data)]);
    return {scenario:data,already_applied:false};
  });
}
module.exports={evidence,validatePrediction,applyActual,conflict};
