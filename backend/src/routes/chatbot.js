const express = require('express');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const CHATBOT_BASE = process.env.CHATBOT_API_URL || 'https://iug-chatbot.onrender.com';
const CHATBOT_DEFAULT_STUDENT_ID = String(process.env.CHATBOT_DEFAULT_STUDENT_ID || '1');
const CHAT_HISTORY_TTL_MS = Number(process.env.CHAT_HISTORY_TTL_MS || 24 * 60 * 60 * 1000);
const CHAT_HISTORY_MAX_MESSAGES = Number(process.env.CHAT_HISTORY_MAX_MESSAGES || 100);
const chatHistoryCache = new Map();

const normalizeSessionId = (sessionId) => {
  const value = String(sessionId || 'default').trim();
  return value || 'default';
};

const getUserCacheKey = (user) => {
  if (user?.id_student) return `student:${user.id_student}`;
  if (user?.id) return `user:${user.id}`;
  if (user?.email) return `email:${user.email}`;
  return 'anonymous';
};

const getCacheKey = (user, sessionId) => `${getUserCacheKey(user)}:${normalizeSessionId(sessionId)}`;

const getCachedMessages = (user, sessionId) => {
  const cacheKey = getCacheKey(user, sessionId);
  const cached = chatHistoryCache.get(cacheKey);

  if (!cached) return [];
  if (cached.expiresAt <= Date.now()) {
    chatHistoryCache.delete(cacheKey);
    return [];
  }

  return cached.messages;
};

const setCachedMessages = (user, sessionId, messages) => {
  const cacheKey = getCacheKey(user, sessionId);
  chatHistoryCache.set(cacheKey, {
    messages: messages.slice(-CHAT_HISTORY_MAX_MESSAGES),
    expiresAt: Date.now() + CHAT_HISTORY_TTL_MS,
  });
};

const appendChatExchange = (user, sessionId, question, data) => {
  const messages = getCachedMessages(user, sessionId);
  const now = new Date().toISOString();

  setCachedMessages(user, sessionId, [
    ...messages,
    { role: 'user', content: question, created_at: now },
    {
      role: 'assistant',
      content: data.answer || data.response || '',
      sources: data.top_chunks || data.sources || [],
      created_at: now,
    },
  ]);
};

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
    const sessionId = normalizeSessionId(session_id);
    const externalSessionId = req.user?.id_student
      ? String(req.user.id_student)
      : CHATBOT_DEFAULT_STUDENT_ID;
    const trimmedQuestion = String(question || '').trim();

    if (!trimmedQuestion) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const response = await fetchWithRetry(
      `${CHATBOT_BASE}/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmedQuestion,
          session_id: externalSessionId,
        }),
      },
      { retries: 3, timeoutMs: 90000 }
    );

    const data = await safeJson(response);
    if (response.ok) {
      appendChatExchange(req.user, sessionId, trimmedQuestion, data);
    }

    return res.status(response.ok ? 200 : response.status).json({
      ...data,
      session_id: sessionId,
    });
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
    const sessionId = normalizeSessionId(req.params.session_id);
    res.json({
      session_id: sessionId,
      messages: getCachedMessages(req.user, sessionId),
    });
  } catch (err) {
    console.error('[chatbot] history error:', err.message);
    res.status(500).json({ error: 'Unable to read cached chat history' });
  }
});

// DELETE /api/chatbot/history/:session_id
router.delete('/history/:session_id', authenticate, async (req, res) => {
  try {
    const sessionId = normalizeSessionId(req.params.session_id);
    chatHistoryCache.delete(getCacheKey(req.user, sessionId));
    res.json({ success: true, session_id: sessionId });
  } catch (err) {
    console.error('[chatbot] history delete error:', err.message);
    res.status(500).json({ error: 'Unable to clear cached chat history' });
  }
});

module.exports = router;
