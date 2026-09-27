const getAllowedOrigins = (env = process.env) => {
  const configured = [env.FRONTEND_URL, ...(env.FRONTEND_URLS || '').split(',')]
    .map((value) => value?.trim()).filter(Boolean);
  const origins = configured.map((value) => {
    let url;
    try { url = new URL(value); } catch { throw new Error('Frontend origins must be absolute HTTP(S) origins'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || value.includes('*')) {
      throw new Error('Frontend origins must not contain credentials, paths, queries, fragments or wildcards');
    }
    return url.origin;
  });
  return new Set(['http://localhost:3000', 'http://localhost:5173', ...origins]);
};

const createCorsOptions = (env = process.env) => {
  const allowed = getAllowedOrigins(env);
  return {
    credentials: true,
    origin(origin, callback) {
      const accepted = !origin || allowed.has(origin);
      if (!accepted) {
        let safeOrigin = '[invalid origin]';
        try { safeOrigin = new URL(origin).origin; } catch { /* Do not log an arbitrary header. */ }
        console.warn('CORS origin denied:', { code: 'CORS_ORIGIN_DENIED', origin: safeOrigin });
      }
      callback(null, accepted);
    },
  };
};

module.exports = { getAllowedOrigins, createCorsOptions };
