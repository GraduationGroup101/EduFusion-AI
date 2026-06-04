const express = require('express');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const CHATBOT_BASE = process.env.CHATBOT_API_URL || 'https://iug-chatbot.onrender.com';

const proxyFetch = async (url, options = {}) => {
  const fetch = global.fetch || (await import('node-fetch')).default;
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

// Retry with timeout — handles Render cold starts (503 / connection errors)
const fetchWithRetry = async (url, options = {}, { retries = 3, timeoutMs = 90000 } = {}) => {
  const fetch = global.fetch || (await import('node-fetch')).default;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);

      // Render cold start returns 503 — wait and retry
      if (response.status === 503 && attempt < retries) {
        console.log(`[chatbot] 503 on attempt ${attempt}, retrying in 3s…`);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      return response;
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err.name === 'AbortError';
      const isNetwork = err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.message?.includes('fetch');

      if ((isAbort || isNetwork) && attempt < retries) {
        console.log(`[chatbot] ${err.message} on attempt ${attempt}, retrying in 3s…`);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      throw err;
    }
  }
};

// POST /api/chatbot/chat
router.post('/chat', authenticate, async (req, res) => {
  try {
    const { question, session_id } = req.body;
    const externalSessionId = req.user?.id_student
      ? String(req.user.id_student)
      : String(session_id || 'default');

    if (!question || !String(question).trim()) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const response = await fetchWithRetry(
      `${CHATBOT_BASE}/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: String(question).trim(),
          session_id: externalSessionId,
        }),
      },
      { retries: 3, timeoutMs: 90000 }
    );

    const data = await safeJson(response);
    return res.status(response.ok ? 200 : response.status).json(data);
  } catch (err) {
    console.error('[chatbot] chat error:', err.message);
    const isAbort = err.name === 'AbortError';
    return res.status(503).json({
      error: isAbort
        ? 'Chatbot is taking too long to respond. Please try again.'
        : 'Chatbot service is unavailable. Please try again in a moment.',
    });
  }
});

// GET /api/chatbot/history/:session_id
router.get('/history/:session_id', authenticate, async (req, res) => {
  try {
    const response = await fetchWithRetry(
      `${CHATBOT_BASE}/history/${req.params.session_id}`,
      {},
      { retries: 2, timeoutMs: 15000 }
    );
    const data = await safeJson(response);
    res.status(response.status).json(data);
  } catch (err) {
    console.error('[chatbot] history error:', err.message);
    res.status(503).json({ error: 'Chatbot service unavailable' });
  }
});

// DELETE /api/chatbot/history/:session_id
router.delete('/history/:session_id', authenticate, async (req, res) => {
  try {
    const response = await fetchWithRetry(
      `${CHATBOT_BASE}/history/${req.params.session_id}`,
      { method: 'DELETE' },
      { retries: 2, timeoutMs: 15000 }
    );
    const data = await safeJson(response);
    res.status(response.status).json(data);
  } catch (err) {
    console.error('[chatbot] history delete error:', err.message);
    res.status(503).json({ error: 'Chatbot service unavailable' });
  }
});

module.exports = router;
