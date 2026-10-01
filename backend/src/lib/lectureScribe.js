const { createHash } = require('node:crypto');
const { ownerKey } = require('./owner');
const CURRENT_LECTURESCRIBE_BASE = 'https://lecturescribe-ai.onrender.com';
// The retired self-hosted domain may linger in a dashboard environment variable
// after a deploy; never let it override the working Render service.
const LEGACY_LECTURESCRIBE_BASES = new Set(['https://lecturescribe.app', 'https://www.lecturescribe.app']);
const resolveLectureScribeBase = (value = process.env.LECTURESCRIBE_API_URL) => {
  const configured = String(value || CURRENT_LECTURESCRIBE_BASE).replace(/\/+$/, '');
  return LEGACY_LECTURESCRIBE_BASES.has(configured) ? CURRENT_LECTURESCRIBE_BASE : configured;
};
const LECTURESCRIBE_BASE = resolveLectureScribeBase();

// Canonical YouTube video ID so the same lecture submitted through any URL form
// (watch, youtu.be, shorts, live, embed, playlists) shares one cached transcript.
const videoId = (value) => {
  let url;
  try { url = new URL(String(value)); } catch { return null; }
  const valid = (id) => (/^[\w-]{11}$/.test(id || '') ? id : null);
  if (url.hostname === 'youtu.be') return valid(url.pathname.split('/')[1]);
  if (url.searchParams.get('v')) return valid(url.searchParams.get('v'));
  const match = url.pathname.match(/^\/(?:shorts|live|embed|v)\/([\w-]{11})/);
  return match ? valid(match[1]) : null;
};

// The provider limits public callers per IP; a shared key identifies this
// gateway (which submits for every student from one address) as trusted, and
// the account key lets the provider limit each student individually. Only an
// opaque digest of the account is sent, never a student ID.
// Trimmed like LectureScribe trims its GATEWAY_KEYS (and fetch trims header values),
// so a key pasted with a trailing newline still matches the callback signatures.
const gatewayKey = (env = process.env) => String(env.LECTURESCRIBE_GATEWAY_KEY ?? '').trim();
const gatewayHeaders = (user, env = process.env) => {
  const key = gatewayKey(env);
  if (!key) return {};
  const headers = { 'X-Gateway-Key': key };
  if (user) headers['X-Gateway-User'] = createHash('sha256').update(ownerKey(user)).digest('hex').slice(0, 40);
  return headers;
};

module.exports = { CURRENT_LECTURESCRIBE_BASE, LECTURESCRIBE_BASE, resolveLectureScribeBase, videoId, gatewayKey, gatewayHeaders };
