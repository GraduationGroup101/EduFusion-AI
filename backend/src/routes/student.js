const express = require('express');
const { randomUUID } = require('node:crypto');
const { authenticate, requireRole } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/limits');
const { getCurrentStudentPrediction, getStudentBehaviorData } = require('../db/queries');
const { saveScenario, getScenario, deleteScenario, setScenarioPlan, scenarioStatus } = require('../db/scenarios');
const db=require('../db');
const {evidence,validatePrediction,applyActual,conflict}=require('../db/scenarioActual');
const { integer, text, badRequest } = require('../lib/validation');
const { requestUpstream, readJson, upstreamStatus, sendError } = require('../lib/upstream');
const router = express.Router();
const EDUPREDICT_BASE = (process.env.EDUPREDICT_API_URL || 'https://edupredict-api-6ob5.onrender.com').replace(/\/+$/, '');
const predictionFailureCategory = async (response) => {
  if ([401, 403].includes(response.status)) return 'upstream_auth';
  if (response.status === 404) return 'upstream_enrollment';
  if (response.status >= 500) {
    const body = await response.json().catch(() => null);
    const detail = typeof body?.detail === 'string' ? body.detail : '';
    if (/\[Errno -2\] Name or service not known|could not translate host name/i.test(detail)) return 'database_dns';
    if (/DATABASE_URL environment variable is not set/i.test(detail)) return 'database_configuration';
    if (/relation .* does not exist/i.test(detail)) return 'schema_mismatch';
  }
  return 'upstream_http';
};
router.use(authenticate, requireRole(['student']));

router.get('/prediction-data', async (req, res) => {
  try { res.json({ enrollments: await getStudentBehaviorData(req.user.id_student) }); }
  catch (error) { sendError(res, error, 'Unable to load academic data'); }
});

// Every scenario route resolves the enrollment through the authenticated
// student's own rows, so a foreign enrollment id is indistinguishable from a
// missing one.
const ownedEnrollment = async (req) => {
  const id = integer(req.params.enrollment_id, 'Enrollment ID', 1);
  const rows = await getStudentBehaviorData(req.user.id_student);
  return { id, course: rows.find((row) => Number(row.enrollment_id) === id) || null };
};

const save = async (req, res) => {
  try {
    const scenario = await saveScenario(req.user.id_student, req.params.enrollment_id, req.body);
    if (!scenario) return res.status(404).json({ error: 'Enrollment not found' });
    return res.json({ scenario, message: 'Scenario saved. Your academic records are unchanged.' });
  } catch (error) { return sendError(res, error, 'Unable to save the scenario'); }
};
router.put('/scenarios/:enrollment_id', aiLimiter, save);
// Preserve the old URL while removing all source-record writes from its boundary.
router.put('/prediction-data/:enrollment_id', aiLimiter, save);
router.get('/scenarios/:enrollment_id', async (req, res) => {
  try {
    const { id, course } = await ownedEnrollment(req);
    if (!course) return res.status(404).json({ error: 'Enrollment not found' });
    const scenario = await getScenario(req.user.id_student, id);
    res.json({ scenario, status: scenarioStatus(scenario, course) });
  } catch (error) { sendError(res, error, 'Unable to read the scenario'); }
});

router.delete('/scenarios/:enrollment_id', async (req, res) => {
  try {
    const { id, course } = await ownedEnrollment(req);
    if (!course) return res.status(404).json({ error: 'Enrollment not found' });
    const deleted = await deleteScenario(req.user.id_student, id);
    if (!deleted) return res.status(404).json({ error: 'No saved scenario to delete' });
    res.json({ deleted: true, message: 'Scenario deleted. Your academic records and actual prediction are unchanged.' });
  } catch (error) { sendError(res, error, 'Unable to delete the scenario'); }
});

router.patch('/scenarios/:enrollment_id/plan', async (req, res) => {
  try {
    if (typeof req.body?.adopted !== 'boolean') throw badRequest('adopted must be true or false');
    const { id, course } = await ownedEnrollment(req);
    if (!course) return res.status(404).json({ error: 'Enrollment not found' });
    const data = await setScenarioPlan(req.user.id_student, id, req.body.adopted);
    if (!data) return res.status(404).json({ error: 'Save a scenario before using it as a plan.' });
    res.json({ scenario: data, message: req.body.adopted
      ? 'Saved as your learning plan. Your academic records are unchanged.'
      : 'Learning plan removed. Your academic records are unchanged.' });
  } catch (error) { sendError(res, error, 'Unable to update the learning plan'); }
});

router.post('/scenarios/:enrollment_id/actual',aiLimiter,async(req,res)=>{
  try {
    if(req.body?.confirm!==true||typeof req.body?.revision!=='string')throw badRequest('Confirm Save as Actual for the reviewed scenario.');
    const id=integer(req.params.enrollment_id,'Enrollment ID',1);
    const result=await applyActual(req.user.id_student,id,req.body.revision);
    if(!result)return res.status(404).json({error:'Enrollment not found'});
    return res.json({...result,message:'Scenario applied to your actual academic records and prediction.'});
  }catch(error){const failure=error.code==='40001'?Object.assign(new Error('Academic records changed. Reload and try again.'),{statusCode:409}):error;sendError(res,failure,'Unable to apply the scenario. No partial changes were saved.');}
});

router.get('/scenarios/:enrollment_id/prediction', aiLimiter, async (req, res) => {
  try {
    const { id, course } = await ownedEnrollment(req);
    if (!course) return res.status(404).json({ error: 'Enrollment not found' });
    const saved = await getScenario(req.user.id_student, id);
    if (!saved) return res.status(404).json({ error: 'Save a scenario before evaluating it.' });
    if(saved.data.applied_at)return res.json({...saved.data.prediction,hypothetical:true,based_on_day:saved.data.based_on_day,applied_at:saved.data.applied_at});
    const status = scenarioStatus(saved, course);
    // Never evaluate stale assumptions silently: a scenario built on another
    // course day or on evidence that no longer exists must be rebuilt first.
    if (status.state === 'stale') return res.status(409).json({ error: 'Course day changed. Update the scenario for the current day.', status });
    if (status.state === 'invalid') return res.status(409).json({ error: 'This scenario no longer matches your academic records.', status });
    const { based_on_day, inputs, activity } = saved.data;
    const before=await evidence(id);
    const params = new URLSearchParams({ code_module: course.code_module, code_presentation: course.code_presentation });
    const response = await requestUpstream(req, `${EDUPREDICT_BASE}/students/${req.user.id_student}/scenario-prediction?${params}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ based_on_day, inputs, activity }),
    });
    if (response.status === 422) {
      return res.status(409).json({ error: 'Scenario evidence changed. Save the scenario again.',
        status: { ...status, state: 'invalid', reasons: ['The prediction model could not apply this scenario to your current records.'] } });
    }
    if (!response.ok) return res.status(503).json({ error: 'Scenario prediction service is temporarily unavailable. Please try again.' });
    const prediction=validatePrediction(await readJson(response));
    const after=await evidence(id);
    if(!before||before.hash!==after?.hash)conflict();
    // Compare the revision at the write boundary: a slow model response must
    // never attach itself to a replaced or deleted scenario.
    const result=await db.query(`UPDATE edufusion_student_scenarios
      SET data=data||$4::jsonb WHERE id_student=$1 AND enrollment_id=$2 AND data->>'revision'=$3`,
    [req.user.id_student,id,saved.data.revision,JSON.stringify({prediction,prediction_available:true,predicted_at:new Date().toISOString(),prediction_evidence_hash:before.hash})]);
    if(!result.rowCount)conflict();
    return res.json({ ...prediction, hypothetical: true, based_on_day, status, revision:saved.data.revision });
  } catch (error) { return sendError(res, error, 'Scenario prediction service is temporarily unavailable. Please try again.'); }
});

router.get('/prediction', aiLimiter, async (req, res) => {
  const requestId = randomUUID();
  res.set('X-Request-Id', requestId);
  let stage = 'enrollment_lookup';
  let module;
  let presentation;
  try {
    const rows = await getStudentBehaviorData(req.user.id_student);
    module = req.query.code_module === undefined ? null : text(req.query.code_module, 'Module', { max: 20 });
    presentation = req.query.code_presentation === undefined ? null : text(req.query.code_presentation, 'Presentation', { max: 20 });
    const course = rows.find((row) => (!module || row.code_module === module) && (!presentation || row.code_presentation === presentation));
    if (!course) return res.status(404).json({ error: 'Enrollment not found' });
    if (!['1', 'true'].includes(req.query.force)) {
      stage = 'cache_lookup';
      const cached = await getCurrentStudentPrediction(req.user.id_student, course.code_module, course.code_presentation);
      if (cached) return res.json({ ...cached, risk_probability: Number(cached.risk_probability),
        threshold_used: cached.threshold_used == null ? null : Number(cached.threshold_used), cached: true });
    }
    const params = new URLSearchParams({ code_module: course.code_module, code_presentation: course.code_presentation });
    stage = 'upstream_request';
    const response = await requestUpstream(req, `${EDUPREDICT_BASE}/students/${req.user.id_student}/prediction?${params}`);
    if (!response.ok) {
      const category = await predictionFailureCategory(response);
      console.error('Prediction request failed:', {
        request_id: requestId, endpoint: '/api/student/prediction', upstream: 'EduPredict',
        upstream_status: response.status, category,
        stage, code_module: course.code_module, code_presentation: course.code_presentation,
      });
      return res.status([401, 403].includes(response.status) ? upstreamStatus(response.status) : 503)
        .json({ error: 'Prediction service is temporarily unavailable. Please try again.' });
    }
    stage = 'upstream_response';
    return res.json(await readJson(response));
  } catch (error) {
    console.error('Prediction request failed:', {
      request_id: requestId, endpoint: '/api/student/prediction', upstream: 'EduPredict',
      category: error.name === 'AbortError' ? 'timeout' : error.statusCode === 502 ? 'invalid_response'
        : stage === 'upstream_request' ? 'connection' : 'local_error',
      stage, code_module: module || null, code_presentation: presentation || null,
      error_code: error.code || error.name,
    });
    return sendError(res, error, 'Prediction service is temporarily unavailable. Please try again.');
  }
});
module.exports = router;
