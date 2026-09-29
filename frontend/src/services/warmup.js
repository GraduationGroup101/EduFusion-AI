import api from './api';

// Free-tier upstreams (transcription, chatbot, question generator, prediction)
// sleep when idle. Signing in asks the gateway to wake them and also pings each
// target from the browser, so the first real request finds an awake service.
let warmed = false;
export const warmServices = async ({ fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) => {
  if (warmed) return [];
  warmed = true;
  try {
    const { data } = await api.get('/services/warm-up', { timeout: 15000 });
    const targets = Array.isArray(data?.targets) ? data.targets : [];
    for (const target of targets) {
      if (typeof target?.url !== 'string' || !/^https:\/\//.test(target.url) || !fetchImpl) continue;
      // Opaque no-cors responses are fine: reaching the host is what wakes it.
      fetchImpl(target.url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit' }).catch(() => {});
    }
    return targets;
  } catch {
    warmed = false;
    return [];
  }
};

export const resetWarmup = () => { warmed = false; };
