const express = require('express');
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/limits');
const { getHistory, appendExchange, deleteHistory } = require('../db/appStore');
const { text } = require('../lib/validation');
const { ownerKey } = require('../lib/owner');
const { requestUpstream, readJson, upstreamStatus } = require('../lib/upstream');
const academic = require('../academicAssistant');

const router = express.Router();

const CURRENT_CHATBOT_BASE = 'https://final-iug-chat-botv3.onrender.com';
const LEGACY_CHATBOT_BASES = new Set([
  'https://iug-chatbot.onrender.com',
  // v2 was removed from Render (it now answers 404 with x-render-routing: no-server).
  'https://final-iug-chat-botv2.onrender.com',
]);
const configuredChatbotBase = String(
  process.env.CHATBOT_API_URL || CURRENT_CHATBOT_BASE
).replace(/\/+$/, '');
// Vercel/Render can retain an old dashboard environment variable after a code
// deploy. Never let the retired chatbot URL override the working endpoint.
const CHATBOT_BASE = LEGACY_CHATBOT_BASES.has(configuredChatbotBase)
  ? CURRENT_CHATBOT_BASE
  : configuredChatbotBase;
const normalizeSessionId = (value) => value === undefined ? 'default' : text(value, 'Session ID', { max: 100 });
const getConversationId = (user, sessionId) => crypto.createHash('sha256').update(`${ownerKey(user)}:${sessionId}`).digest('hex');

const toGuestHistory = (messages) => {
  const turns = [];

  for (let index = 0; index < messages.length - 1; index += 1) {
    const userMessage = messages[index];
    const assistantMessage = messages[index + 1];

    if (userMessage?.role === 'user' && assistantMessage?.role === 'assistant') {
      turns.push({
        user: String(userMessage.content || '').slice(0, 2000),
        assistant: String(assistantMessage.content || '').slice(0, 20000),
      });
      index += 1;
    }
  }

  return turns.filter((turn) => turn.user && turn.assistant).slice(-5);
};

const upstreamErrorMessage = (data) => {
  if (typeof data?.error === 'string') return data.error;
  if (typeof data?.error?.message === 'string') return data.error.message;
  if (typeof data?.detail === 'string') return data.detail;
  return 'Chatbot service rejected the request';
};

// POST /api/chatbot/chat
router.post('/chat', authenticate, aiLimiter, async (req, res) => {
  try {
    const { question, session_id } = req.body;
    const sessionId = normalizeSessionId(session_id);
    const trimmedQuestion = text(question, 'Question', { max: 2000 });

    if (!trimmedQuestion) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const history = await getHistory(req.user, sessionId);
    // Questions about a student's own standing (or, for staff, any student's) are
    // answered from EduFusion's records; the university chatbot never sees them.
    const local = await academic.respond({ user: req.user, question: trimmedQuestion, history });
    if (local) {
      await appendExchange(req.user, sessionId, trimmedQuestion, local);
      return res.json({ ...local, session_id: sessionId });
    }

    const response = await requestUpstream(req,
      `${CHATBOT_BASE}/api/chat/guest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmedQuestion,
          conversation_id: getConversationId(req.user, sessionId),
          history: toGuestHistory(history),
        }),
      },
      { timeoutMs: 80000 }
    );

    const data = await readJson(response);
    if (!response.ok) {
      return res.status(upstreamStatus(response.status)).json({
        error: upstreamErrorMessage(data),
        session_id: sessionId,
      });
    }

    const answer = data.answer || data.response;
    if (typeof answer !== 'string' || !answer.trim()) throw Object.assign(new Error('Invalid chatbot response'), { statusCode: 502 });
    data.answer = answer;
    await appendExchange(req.user, sessionId, trimmedQuestion, data);

    return res.json({
      ...data,
      session_id: sessionId,
    });
  } catch (err) {
    console.error('[chatbot] chat error:', err.message);
    const isAbort = err.name === 'AbortError';
    return res.status(err.statusCode || (err.name === 'AbortError' ? 504 : 503)).json({
      error: err.statusCode === 400 ? err.message : isAbort
        ? 'Chatbot is taking too long to respond. Please try again.'
        : 'Chatbot service is unavailable. Please try again in a moment.',
    });
  }
});

// Lightweight upstream liveness check used by the EduFusion chat page.
router.get('/health', authenticate, async (req, res) => {
  try {
    const response = await requestUpstream(req,
      `${CHATBOT_BASE}/live`,
      { headers: { Accept: 'application/json' } },
      { retries: 1, timeoutMs: 20000 }
    );
    const data = await readJson(response);

    if (!response.ok) {
      return res.status(upstreamStatus(response.status)).json({ error: upstreamErrorMessage(data) });
    }

    return res.json({ status: 'online', upstream: data });
  } catch (err) {
    console.error('[chatbot] health error:', err.message);
    return res.status(503).json({ error: 'Chatbot service is unavailable' });
  }
});

// GET /api/chatbot/history/:session_id
router.get('/history/:session_id', authenticate, async (req, res) => {
  try {
    const sessionId = normalizeSessionId(req.params.session_id);
    res.json({
      session_id: sessionId,
      messages: await getHistory(req.user, sessionId),
    });
  } catch (err) {
    console.error('[chatbot] history error:', err.message);
    res.status(err.statusCode || 503).json({ error: err.statusCode === 400 ? err.message : 'Unable to read chat history' });
  }
});

// DELETE /api/chatbot/history/:session_id
router.delete('/history/:session_id', authenticate, async (req, res) => {
  try {
    const sessionId = normalizeSessionId(req.params.session_id);
    await deleteHistory(req.user, sessionId);
    res.json({ success: true, session_id: sessionId });
  } catch (err) {
    console.error('[chatbot] history delete error:', err.message);
    res.status(err.statusCode || 503).json({ error: err.statusCode === 400 ? err.message : 'Unable to clear chat history' });
  }
});

module.exports = router;
module.exports.CHATBOT_BASE = CHATBOT_BASE;
