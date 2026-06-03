const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const EDUPREDICT_BASE = process.env.EDUPREDICT_API_URL || 'https://edupredict-api-isex.onrender.com';

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

router.get('/students/at-risk', adminOnly, async (req, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query.risk_level) params.set('risk_level', req.query.risk_level);
    if (req.query.at_risk) params.set('at_risk', req.query.at_risk);
    if (req.query.limit) params.set('limit', req.query.limit);

    const response = await proxyFetch(`${EDUPREDICT_BASE}/admin/students/at-risk?${params}`, {
      headers: adminHeaders(),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Admin at-risk proxy error:', err);
    res.status(500).json({ error: 'Failed to fetch at-risk students' });
  }
});

router.post('/predictions/run-demo', adminOnly, async (req, res) => {
  try {
    const limit = req.query.limit || req.body?.limit || 150;
    const response = await proxyFetch(`${EDUPREDICT_BASE}/admin/predictions/run-demo?limit=${limit}`, {
      method: 'POST',
      headers: adminHeaders(),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Admin run-demo proxy error:', err);
    res.status(500).json({ error: 'Failed to run demo predictions' });
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
