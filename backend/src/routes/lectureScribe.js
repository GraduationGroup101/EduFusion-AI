const express = require('express');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const LECTURESCRIBE_BASE = String(
  process.env.LECTURESCRIBE_API_URL || 'https://lecturescribe.app'
).replace(/\/+$/, '');

const proxyFetch = async (path, options = {}, timeoutMs = 30000) => {
  const fetch = global.fetch || (await import('node-fetch')).default;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(`${LECTURESCRIBE_BASE}${path}`, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const readJson = async (response) => {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || 'LectureScribe returned an invalid response' };
  }
};

const sendProxyError = (res, err) => {
  console.error('[lecture-scribe] proxy error:', err.message);
  return res.status(err.name === 'AbortError' ? 504 : 503).json({
    error:
      err.name === 'AbortError'
        ? 'LectureScribe is taking too long to respond.'
        : 'LectureScribe is unavailable. Confirm that its API and Cloudflare tunnel are running.',
  });
};

router.get('/health', authenticate, async (req, res) => {
  try {
    const response = await proxyFetch('/health', {}, 15000);
    const data = await readJson(response);
    return res.status(response.status).json(data);
  } catch (err) {
    return sendProxyError(res, err);
  }
});

router.post('/jobs', authenticate, async (req, res) => {
  try {
    const response = await proxyFetch('/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    });
    const data = await readJson(response);
    return res.status(response.status).json(data);
  } catch (err) {
    return sendProxyError(res, err);
  }
});

router.get('/jobs', authenticate, async (req, res) => {
  try {
    const response = await proxyFetch('/jobs');
    const data = await readJson(response);
    return res.status(response.status).json(data);
  } catch (err) {
    return sendProxyError(res, err);
  }
});

router.get('/jobs/:jobId', authenticate, async (req, res) => {
  try {
    const response = await proxyFetch(`/jobs/${encodeURIComponent(req.params.jobId)}`);
    const data = await readJson(response);
    return res.status(response.status).json(data);
  } catch (err) {
    return sendProxyError(res, err);
  }
});

router.get('/jobs/:jobId/transcript', authenticate, async (req, res) => {
  try {
    const kind = req.query.kind === 'raw' ? 'raw' : 'cleaned';
    const response = await proxyFetch(
      `/jobs/${encodeURIComponent(req.params.jobId)}/transcript?kind=${kind}`
    );
    const body = await response.text();

    if (!response.ok) {
      try {
        return res.status(response.status).json(JSON.parse(body));
      } catch {
        return res.status(response.status).json({ error: body || 'Unable to load transcript' });
      }
    }

    return res.status(response.status).type('text/plain; charset=utf-8').send(body);
  } catch (err) {
    return sendProxyError(res, err);
  }
});

module.exports = router;
