const { getAllowedOrigins } = require('./lib/corsOrigins');
const validateEnvironment = (env = process.env) => {
  const issues = [];
  try { getAllowedOrigins(env); } catch (error) { issues.push(error.message); }
  if (!env.DATABASE_URL) issues.push('DATABASE_URL is required');
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || /^(change[-_ ]?this|replace[-_ ]?with|your[-_ ]|changeme|secret$)/i.test(env.JWT_SECRET)) issues.push('JWT_SECRET must be a unique secret of at least 32 characters');
  for (const key of ['DATABASE_URL','CHATBOT_API_URL','EDUPREDICT_API_URL','LECTURESCRIBE_API_URL','QUESTION_GENERATOR_API_URL']) {
    if (!env[key]) continue;
    try {
      const url = new URL(env[key]);
      if (key === 'DATABASE_URL' ? !['postgres:','postgresql:'].includes(url.protocol) : !['http:','https:'].includes(url.protocol)) issues.push(`Invalid ${key} protocol`);
    } catch { issues.push(`Invalid ${key}`); }
  }
  if (env.DB_SSL !== undefined && !['true','false'].includes(env.DB_SSL)) issues.push('DB_SSL must be true or false');
  if (env.TRUST_PROXY !== undefined && !/^[0-3]$/.test(env.TRUST_PROXY)) issues.push('TRUST_PROXY must be a hop count from 0 to 3');
  if (env.PREDICTION_SEED_TIMEOUT_MS && (!/^\d+$/.test(env.PREDICTION_SEED_TIMEOUT_MS) || Number(env.PREDICTION_SEED_TIMEOUT_MS)>10000 || Number(env.PREDICTION_SEED_TIMEOUT_MS)<100)) issues.push('Invalid PREDICTION_SEED_TIMEOUT_MS');
  if (issues.length) throw new Error(issues.join('; '));
};
// Settings a hosted deployment runs without, at a real cost worth announcing.
const environmentWarnings = (env = process.env) => {
  const warnings = [];
  if ((env.VERCEL || env.RENDER) && !String(env.LECTURESCRIBE_GATEWAY_KEY ?? '').trim()) {
    warnings.push('LECTURESCRIBE_GATEWAY_KEY is not set: LectureScribe cannot report finished lectures (no completion callbacks), so a lecture that finishes while nobody watches can be lost when the service restarts, and every student shares its per-IP job limit');
  }
  return warnings;
};
module.exports = { validateEnvironment, environmentWarnings };
