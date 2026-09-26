const { setTimeout: delay } = require('node:timers/promises');

// One deadline covers connection, retries and response body consumption.
const requestUpstream = async (req, url, options = {}, { timeoutMs = 80000, retries = 0, maxBytes = 10 * 1024 * 1024 } = {}) => {
  const controller = new AbortController();
  const abort = () => { if (!req?.res?.writableEnded) controller.abort(); };
  req?.res?.once('close', abort);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (response.status === 503 && attempt < retries && (!options.method || options.method === 'GET')) {
        await response.body?.cancel?.();
        await delay(1000, undefined, { signal: controller.signal });
        continue;
      }
      const chunks = [];
      let bytes = 0;
      if (response.body) {
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            controller.abort();
            throw Object.assign(new Error('Upstream response is too large'), { statusCode: 502 });
          }
          chunks.push(Buffer.from(chunk));
        }
      }
      return new Response([204, 205, 304].includes(response.status) ? null : Buffer.concat(chunks), {
        status: response.status, headers: response.headers,
      });
    }
  } finally {
    clearTimeout(timer);
    req?.res?.removeListener('close', abort);
  }
};

const readJson = async (response) => {
  try { return await response.json(); }
  catch { throw Object.assign(new Error('The external service returned an invalid response'), { statusCode: 502 }); }
};

// An upstream 401 describes our provider connection, not the user's session.
const upstreamStatus = (status) => [401, 403].includes(status) ? 502 : status;
const sendError = (res, error, message = 'The external service is temporarily unavailable') =>
  res.status(error.statusCode || (error.name === 'AbortError' ? 504 : 503)).json({ error: error.statusCode >= 400 && error.statusCode < 500 ? error.message : message });

module.exports = { requestUpstream, readJson, upstreamStatus, sendError };
