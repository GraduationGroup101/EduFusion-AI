const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const express = require('express');

const originalChatbotApiUrl = process.env.CHATBOT_API_URL;
process.env.CHATBOT_API_URL = 'https://iug-chatbot.onrender.com/';

const originalFetch = global.fetch;
const upstreamCalls = [];
let upstreamMode = 'success';

const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    authenticate: (req, res, next) => {
      req.user = { id_student: 123, role: 'student', is_active: true };
      next();
    },
  },
};

global.fetch = async (input, options = {}) => {
  const url = String(input);
  if (url.startsWith('http://127.0.0.1:')) {
    return originalFetch(input, options);
  }

  upstreamCalls.push({ url, options });
  if (url.endsWith('/live')) {
    return new Response(JSON.stringify({ status: 'alive' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (upstreamMode === 'error') {
    return new Response(JSON.stringify({
      success: false,
      error: { message: 'Upstream rate limit' },
    }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = JSON.parse(options.body);
  return new Response(JSON.stringify({
    answer: `answer:${body.question}`,
    source: 'knowledge_base',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const chatbotRouter = require('../src/routes/chatbot');

const app = express();
app.use(express.json());
app.use('/api/chatbot', chatbotRouter);

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  global.fetch = originalFetch;
  if (originalChatbotApiUrl === undefined) {
    delete process.env.CHATBOT_API_URL;
  } else {
    process.env.CHATBOT_API_URL = originalChatbotApiUrl;
  }
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('proxies chat to the current guest API and forwards completed history', async () => {
  const sessionId = '1f5141f0-2d60-4ef8-a351-aad8af97d52a';

  const first = await originalFetch(`${baseUrl}/api/chatbot/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'first', session_id: sessionId }),
  });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {
    answer: 'answer:first',
    source: 'knowledge_base',
    session_id: sessionId,
  });

  const firstUpstream = JSON.parse(upstreamCalls.at(-1).options.body);
  assert.equal(upstreamCalls.at(-1).url, 'https://final-iug-chat-botv2.onrender.com/api/chat/guest');
  assert.match(firstUpstream.conversation_id, /^[a-f0-9]{64}$/);
  assert.deepEqual(firstUpstream.history, []);

  const second = await originalFetch(`${baseUrl}/api/chatbot/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'follow up', session_id: sessionId }),
  });
  assert.equal(second.status, 200);

  const secondUpstream = JSON.parse(upstreamCalls.at(-1).options.body);
  assert.equal(secondUpstream.conversation_id, firstUpstream.conversation_id);
  assert.deepEqual(secondUpstream.history, [
    { user: 'first', assistant: 'answer:first' },
  ]);
});

test('maps the chatbot error envelope to an EduFusion string error', async () => {
  upstreamMode = 'error';
  const response = await originalFetch(`${baseUrl}/api/chatbot/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: 'limited',
      session_id: 'a96580c9-cc4a-4fce-b46d-d98a1c48e377',
    }),
  });
  upstreamMode = 'success';

  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    error: 'Upstream rate limit',
    session_id: 'a96580c9-cc4a-4fce-b46d-d98a1c48e377',
  });
});

test('reports live status from the current chatbot', async () => {
  const response = await originalFetch(`${baseUrl}/api/chatbot/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'online',
    upstream: { status: 'alive' },
  });
  assert.equal(upstreamCalls.at(-1).url, 'https://final-iug-chat-botv2.onrender.com/live');
});
