const express = require('express');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const QUESTION_GENERATOR_BASE =
  process.env.QUESTION_GENERATOR_API_URL || 'https://question-generator-api-pol9.onrender.com';

const proxyFetch = async (url, options = {}) => {
  const fetch = (await import('node-fetch')).default;
  return fetch(url, options);
};

const safeJson = async (response) => {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || 'Invalid JSON response' };
  }
};

router.get('/health', authenticate, async (req, res) => {
  try {
    const response = await proxyFetch(`${QUESTION_GENERATOR_BASE}/health`);
    const data = await safeJson(response);
    res.status(response.status).json(data);
  } catch (err) {
    console.error('[question-generator] health error:', err.message);
    res.status(503).json({ error: 'Question generator service is unavailable' });
  }
});

router.post('/generate', authenticate, async (req, res) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);

  try {
    const contentType = req.headers['content-type'];
    if (!contentType?.includes('multipart/form-data')) {
      clearTimeout(timer);
      return res.status(400).json({ error: 'multipart/form-data request is required' });
    }

    const headers = { 'Content-Type': contentType };
    if (req.headers['content-length']) {
      headers['Content-Length'] = req.headers['content-length'];
    }

    const response = await proxyFetch(`${QUESTION_GENERATOR_BASE}/generate`, {
      method: 'POST',
      headers,
      body: req,
      signal: controller.signal,
    });

    clearTimeout(timer);
    const data = await safeJson(response);
    return res.status(response.ok ? 200 : response.status).json(data);
  } catch (err) {
    clearTimeout(timer);
    console.error('[question-generator] generate error:', err.message);
    return res.status(503).json({
      error:
        err.name === 'AbortError'
          ? 'Question generation is taking too long. Please try a smaller file.'
          : 'Question generator service is unavailable. Please try again in a moment.',
    });
  }
});

module.exports = router;
