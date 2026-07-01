const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  getCurrentAtRiskStudents,
  getLatestPredictionRiskCounts,
  updateAllAcademicClocks,
} = require('../db/queries');

const router = express.Router();

const EDUPREDICT_BASE = process.env.EDUPREDICT_API_URL || 'https://edupredict-api-6ob5.onrender.com';

const proxyFetch = async (url, options = {}) => {
  const fetch = global.fetch || (await import('node-fetch')).default;
  return fetch(url, options);
};

const adminHeaders = () => {
  if (!process.env.ADMIN_API_KEY) {
    throw new Error('ADMIN_API_KEY is not configured');
  }
  return { 'X-Admin-Key': process.env.ADMIN_API_KEY };
};

const adminOnly = [authenticate, requireRole(['admin', 'advisor'])];

const runDemoPredictionBatch = async (limit = 150) => {
  const response = await proxyFetch(`${EDUPREDICT_BASE}/admin/predictions/run-demo?limit=${limit}`, {
    method: 'POST',
    headers: adminHeaders(),
  });
  const data = await response.json();

  if (!response.ok) {
    const message = data.detail || data.error || 'Failed to run demo predictions';
    throw new Error(message);
  }

  return data;
};

router.get('/students/at-risk', adminOnly, async (req, res) => {
  try {
    const students = await getCurrentAtRiskStudents({
      riskLevel: req.query.risk_level,
      atRisk: req.query.at_risk,
      limit: parseInt(req.query.limit, 10) || 50,
    });
    res.json({ students });
  } catch (err) {
    console.error('Admin at-risk error:', err);
    res.status(500).json({ error: 'Failed to fetch at-risk students' });
  }
});

router.post('/predictions/run-demo', adminOnly, async (req, res) => {
  try {
    const limit = req.query.limit || req.body?.limit || 150;
    const data = await runDemoPredictionBatch(limit);
    res.json(data);
  } catch (err) {
    console.error('Admin run-demo proxy error:', err);
    res.status(500).json({ error: 'Failed to run demo predictions' });
  }
});

router.get('/predictions/risk-counts', adminOnly, async (req, res) => {
  try {
    const counts = await getLatestPredictionRiskCounts();
    res.json(counts);
  } catch (err) {
    console.error('Admin risk counts error:', err);
    res.status(500).json({ error: 'Failed to fetch risk counts' });
  }
});

router.get('/students/:id_student/prediction', adminOnly, async (req, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query.code_module) params.set('code_module', req.query.code_module);
    if (req.query.code_presentation) params.set('code_presentation', req.query.code_presentation);

    const qs = params.toString();
    const response = await proxyFetch(
      `${EDUPREDICT_BASE}/students/${req.params.id_student}/prediction${qs ? `?${qs}` : ''}`
    );
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Admin student prediction proxy error:', err);
    res.status(500).json({ error: 'Failed to fetch student prediction' });
  }
});

router.get('/clock', adminOnly, async (req, res) => {
  try {
    const response = await proxyFetch(`${EDUPREDICT_BASE}/admin/clock`, {
      headers: adminHeaders(),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Admin clock proxy error:', err);
    res.status(500).json({ error: 'Failed to fetch academic clocks' });
  }
});

router.post('/clock/tick-all', adminOnly, async (req, res) => {
  try {
    const days = Number.parseInt(req.body?.days ?? 1, 10);
    const result = await updateAllAcademicClocks({ tickDays: Number.isNaN(days) ? 1 : days });
    const predictions = await runDemoPredictionBatch(req.body?.limit || 150);
    res.json({ ...result, predictions });
  } catch (err) {
    console.error('Admin global clock tick error:', err);
    res.status(500).json({ error: 'Failed to update all academic clocks' });
  }
});

router.post('/clock/reset-all', adminOnly, async (req, res) => {
  try {
    const day = Number.parseInt(req.body?.day ?? 60, 10);
    const result = await updateAllAcademicClocks({ day: Number.isNaN(day) ? 60 : day });
    const predictions = await runDemoPredictionBatch(req.body?.limit || 150);
    res.json({ ...result, predictions });
  } catch (err) {
    console.error('Admin global clock reset error:', err);
    res.status(500).json({ error: 'Failed to reset all academic clocks' });
  }
});

router.post('/clock/tick', adminOnly, async (req, res) => {
  try {
    const { code_module, code_presentation, days = 1 } = req.body;
    const params = new URLSearchParams({ code_module, code_presentation, days: String(days) });
    const response = await proxyFetch(`${EDUPREDICT_BASE}/admin/clock/tick?${params}`, {
      method: 'POST',
      headers: adminHeaders(),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Admin clock tick proxy error:', err);
    res.status(500).json({ error: 'Failed to update academic clock' });
  }
});

router.post('/clock/reset', adminOnly, async (req, res) => {
  try {
    const { code_module, code_presentation, day = 60 } = req.body;
    const params = new URLSearchParams({ code_module, code_presentation, day: String(day) });
    const response = await proxyFetch(`${EDUPREDICT_BASE}/admin/clock/reset?${params}`, {
      method: 'POST',
      headers: adminHeaders(),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Admin clock reset proxy error:', err);
    res.status(500).json({ error: 'Failed to reset academic clock' });
  }
});

module.exports = router;
