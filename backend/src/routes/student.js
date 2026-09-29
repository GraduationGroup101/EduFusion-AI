const express = require('express');
const { randomUUID } = require('node:crypto');
const { authenticate, requireRole } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/limits');
const { getCurrentStudentPrediction, getStudentBehaviorData } = require('../db/queries');
const { saveScenario, getScenario } = require('../db/scenarios');
const { integer, text } = require('../lib/validation');
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
    const id = integer(req.params.enrollment_id, 'Enrollment ID', 1);
    const rows = await getStudentBehaviorData(req.user.id_student);
    if (!rows.some((row) => Number(row.enrollment_id) === id)) return res.status(404).json({ error: 'Enrollment not found' });
    res.json({ scenario: await getScenario(req.user.id_student, id) });
  } catch (error) { sendError(res, error, 'Unable to read the scenario'); }
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
