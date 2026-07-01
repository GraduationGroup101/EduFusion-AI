const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  getCurrentStudentPrediction,
  getStudentBehaviorData,
  updateStudentBehaviorData,
} = require('../db/queries');

const router = express.Router();

const EDUPREDICT_BASE = process.env.EDUPREDICT_API_URL || 'https://edupredict-api-6ob5.onrender.com';

const proxyFetch = async (url, options = {}) => {
  const fetch = global.fetch || (await import('node-fetch')).default;
  return fetch(url, options);
};

const withTimeout = (ms = 85000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, timer };
};

const studentOnly = [authenticate, requireRole(['student'])];

router.get('/prediction-data', studentOnly, async (req, res) => {
  try {
    const enrollments = await getStudentBehaviorData(req.user.id_student);
    res.json({ enrollments });
  } catch (err) {
    console.error('Student prediction data error:', err);
    res.status(500).json({ error: 'Failed to fetch student data' });
  }
});

router.put('/prediction-data/:enrollment_id', studentOnly, async (req, res) => {
  try {
    const updated = await updateStudentBehaviorData(
      req.user.id_student,
      Number.parseInt(req.params.enrollment_id, 10),
      req.body || {}
    );

    if (!updated) {
      return res.status(404).json({ error: 'Enrollment not found for this student' });
    }

    const enrollments = await getStudentBehaviorData(req.user.id_student);
    res.json({ message: 'Student data updated', warnings: updated.warnings || [], enrollments });
  } catch (err) {
    console.error('Student prediction data update error:', err);
    res.status(500).json({ error: err.message || 'Failed to update student data' });
  }
});

router.get('/prediction', studentOnly, async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    if (!force) {
      const cached = await getCurrentStudentPrediction(
        req.user.id_student,
        req.query.code_module,
        req.query.code_presentation
      );

      if (cached) {
        return res.json({
          risk_probability: Number(cached.risk_probability),
          risk_level: cached.risk_level,
          at_risk: cached.at_risk,
          recommended_action: cached.recommended_action,
          explanation: cached.explanation || [],
          threshold_used: cached.threshold_used === null ? null : Number(cached.threshold_used),
          model_confidence: cached.model_confidence,
          data_completeness: cached.data_completeness,
          cached: true,
          created_at: cached.created_at,
        });
      }
    }

    const params = new URLSearchParams();
    if (req.query.code_module) params.set('code_module', req.query.code_module);
    if (req.query.code_presentation) params.set('code_presentation', req.query.code_presentation);

    const qs = params.toString();
    const { controller, timer } = withTimeout();
    const response = await proxyFetch(
      `${EDUPREDICT_BASE}/students/${req.user.id_student}/prediction${qs ? `?${qs}` : ''}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Student prediction proxy error:', err);
    const isAbort = err.name === 'AbortError';
    res.status(isAbort ? 504 : 500).json({
      error: isAbort
        ? 'Prediction service is taking too long. Please try again in a moment.'
        : 'Failed to fetch prediction',
    });
  }
});

module.exports = router;
