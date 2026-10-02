import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

const capture = async () => {
  const { default: api, chatbotService } = await import('../services/api');
  const seen = [];
  api.defaults.adapter = async (config) => { seen.push(config.baseURL); return { data: {}, status: 200, statusText: 'OK', headers: {}, config }; };
  await chatbotService.sendMessage('Am I at risk?', 'session-1');
  await chatbotService.getHistory('session-1');
  await chatbotService.health();
  await chatbotService.clearHistory('session-1');
  return seen;
};

it('sends every chatbot request to the long-lived gateway that holds the model key', async () => {
  vi.stubEnv('VITE_ORAL_EXAM_API_URL', 'https://edufusion-gateway.onrender.com/api');
  expect(await capture()).toEqual(Array(4).fill('https://edufusion-gateway.onrender.com/api'));
});

it('prefers a dedicated chatbot gateway and otherwise keeps the main API', async () => {
  vi.stubEnv('VITE_CHATBOT_API_URL', 'https://chat-gateway.example/api');
  vi.stubEnv('VITE_ORAL_EXAM_API_URL', 'https://edufusion-gateway.onrender.com/api');
  expect(new Set(await capture())).toEqual(new Set(['https://chat-gateway.example/api']));
  vi.unstubAllEnvs(); vi.resetModules();
  vi.stubEnv('VITE_CHATBOT_API_URL', '');
  vi.stubEnv('VITE_ORAL_EXAM_API_URL', '');
  const { default: api } = await import('../services/api');
  expect(new Set(await capture())).toEqual(new Set([api.defaults.baseURL]));
});
