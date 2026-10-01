// The durable lecture library: every saved LectureScribe job, its stored
// transcripts and their reuse. The transcription service runs on ephemeral
// hosting (jobs and files vanish on restart), so whatever it finishes is copied
// here as soon as EduFusion observes it, and every reader prefers this copy.
const { createHmac, timingSafeEqual } = require('node:crypto');
const { readQuery } = require('../db');
const store = require('../db/appStore');
const cache = require('../db/lectureCache');
const { requestUpstream } = require('../lib/upstream');
const { LECTURESCRIBE_BASE: BASE, videoId, gatewayKey, gatewayHeaders } = require('../lib/lectureScribe');

const KINDS = ['cleaned', 'raw'];
const TERMINAL = new Set(['completed', 'failed']);
const JOB_ID = /^[A-Za-z0-9_-]{1,100}$/;
const LOST_ERROR = 'The transcription service restarted before this lecture finished. Submit it again.';
const UNSAVED_ERROR = 'The lecture finished, but the transcription service restarted before its transcript was saved. Submit it again.';
const STATUS_FIELDS = ['status', 'stage', 'stage_label', 'progress_percent', 'current_step', 'total_steps', 'stage_started_at',
  'estimated_stage_seconds', 'submitted_at', 'started_at', 'finished_at', 'error'];
const CALLBACK_MAX_SKEW_SECONDS = 600;
// How long after finishing a lecture's missing transcripts are fetched again on
// list refreshes. The provider forgets finished jobs within minutes to hours.
const REPAIR_WINDOW_SECONDS = 2 * 24 * 60 * 60;

const jobUrl = (jobId, suffix = '') => `${BASE}/jobs/${encodeURIComponent(jobId)}${suffix}`;
const compact = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
const nowSeconds = () => Math.floor(Date.now() / 1000);
const logFailure = (message, error) => console.error(message, error?.code || error?.name || 'Error');

const MODES = ['formatted', 'fast'];
const modeOf = (request) => (request?.clean === false ? 'fast' : 'formatted');
// The mode of the transcript a finished job really produced. A formatted request
// that no model could format comes back 'fast' and must never be reused as AI formatting.
const producedModeOf = (job) => (MODES.includes(job?.result?.mode) ? job.result.mode : null);

const LANGUAGE_NAMES = { arabic: 'ar', english: 'en' };
const normalizeLanguage = (value) => {
  const name = String(value ?? '').trim().toLowerCase();
  const code = LANGUAGE_NAMES[name] || name.split(/[-_]/)[0];
  return /^[a-z]{2}$/.test(code) ? code : null;
};
// The language a text is really in, from its share of Arabic letters.
const ARABIC_LETTER = /[\p{Script=Arabic}&&\p{L}]/gv;
const LATIN_LETTER = /[\p{Script=Latin}&&\p{L}]/gv;
const detectTextLanguage = (text) => {
  const sample = String(text ?? '').slice(0, 200000);
  const arabic = sample.match(ARABIC_LETTER)?.length || 0;
  const latin = sample.match(LATIN_LETTER)?.length || 0;
  if (arabic + latin < 20) return null;
  return arabic / (arabic + latin) >= 0.3 ? 'ar' : 'en';
};

// Every provider call carries the gateway key, so the provider can keep EduFusion
// students' jobs out of its public listing; reads need it as much as submissions.
const providerHeaders = (user) => gatewayHeaders(user || null);

const detectedOf = (job) => normalizeLanguage(job?.detected_language ?? job?.result?.detected_language ?? job?.result?.transcription_info?.detected_language);
const formatVersionOf = (job) => job?.format_version || job?.result?.format_version || null;
const youtubeUrlOf = (job) => job?.youtube_url || job?.request?.youtube_url || null;

// Kinds the provider reported for a finished job (only rows synced by this
// version record them; older rows carry provider paths instead).
const reportedKinds = (job) => KINDS.filter((kind) => job?.result?.[`has_${kind}`] === true);
// A reported kind EduFusion has not stored yet: its download failed, so it is
// fetched again while the provider still has it.
const missingKinds = (job, stored = []) => reportedKinds(job).filter((kind) => !stored.includes(kind));
// A completed lecture whose transcripts are not all stored yet.
const awaitingTranscripts = (job, stored = []) => job?.status === 'completed' && !job.lost
  && (!stored.length || missingKinds(job, stored).length > 0);
const finishedRecently = (job) => {
  const at = Number(job?.finished_at ?? job?.submitted_at);
  return at > 0 && nowSeconds() - at < REPAIR_WINDOW_SECONDS;
};

// What clients may see of a job: no provider file paths, audio paths or internals.
const publicJob = (job, kinds) => {
  if (!job) return null;
  const request = job.request && typeof job.request === 'object' ? job.request : {};
  const result = job.result && typeof job.result === 'object' ? job.result : {};
  // Stored kinds are what a reader gets without the provider. A reported kind not
  // stored yet is fetched again when the lecture is opened or the list refreshes.
  const stored = Array.isArray(kinds) && kinds.length ? kinds : null;
  const hasCleaned = stored ? stored.includes('cleaned') : Boolean(result.has_cleaned ?? result.cleaned_transcript_path);
  const hasRaw = stored ? stored.includes('raw')
    : Boolean(result.has_raw ?? (result.raw_transcript_path || (job.status === 'completed' && !hasCleaned)));
  const detected = detectedOf(job);
  const produced = producedModeOf(job);
  const view = { job_id: job.job_id };
  for (const key of STATUS_FIELDS) view[key] = job[key] ?? null;
  if (typeof view.error === 'string') view.error = view.error.slice(0, 500);
  return Object.assign(view, {
    // Lectures waiting ahead of this one (the provider transcribes one at a time).
    jobs_ahead: view.status === 'queued' && Number.isInteger(job.jobs_ahead) && job.jobs_ahead >= 0 ? job.jobs_ahead : null,
    cached: Boolean(job.cached), shared: Boolean(job.shared), lost: Boolean(job.lost),
    title: job.title || result.title || null,
    video_id: job.video_id || videoId(youtubeUrlOf(job)) || null,
    youtube_url: youtubeUrlOf(job),
    language: job.language || request.language || null,
    mode: job.mode || (job.request ? modeOf(request) : null),
    // What was really produced: a formatted request no model could format comes back 'fast'.
    produced_mode: produced,
    detected_language: detected,
    request: { youtube_url: request.youtube_url ?? null, clean: request.clean ?? null, language: request.language ?? null },
    result: { has_cleaned: hasCleaned, has_raw: hasRaw, cleaned_transcript_path: hasCleaned ? 'stored' : null,
      detected_language: detected, format_version: formatVersionOf(job), produced_mode: produced },
  });
};

// Metadata stored with a transcript: the saved request, plus what the provider reported.
const transcriptMeta = (job, detectedLanguage) => compact({
  videoId: job?.video_id || videoId(youtubeUrlOf(job)),
  youtubeUrl: youtubeUrlOf(job),
  title: job?.title || job?.result?.title,
  language: job?.language || job?.request?.language,
  mode: producedModeOf(job) || job?.mode || (job?.request ? modeOf(job.request) : undefined),
  detectedLanguage: detectedOf(job) || detectedLanguage,
  formatVersion: formatVersionOf(job),
});

// Downloads one kind from the provider and stores it. A failed cache write is
// logged, not raised: the text is still returned and a later read stores it.
const fetchTranscript = async (jobId, kind, { user, job, timeoutMs = 30000 } = {}) => {
  let response;
  try {
    response = await requestUpstream(null, jobUrl(jobId, `/transcript?kind=${kind}`), { headers: providerHeaders(user) },
      { timeoutMs, maxBytes: cache.MAX_TRANSCRIPT_CHARS * 4 });
  } catch { return null; }
  if (!response.ok) return null;
  const content = await response.text();
  if (!content.trim()) return null;
  const owner = job ?? await store.getAnyJob(jobId);
  const meta = transcriptMeta(owner, normalizeLanguage(response.headers.get('content-language')) || detectTextLanguage(content));
  try { await cache.saveTranscript(jobId, kind, content, meta); }
  catch (error) { logFailure('Transcript cache write failed:', error); }
  return { content, language: meta.detectedLanguage || null };
};

// Stored copy first; otherwise the provider's copy, which is then stored.
const readTranscript = async (jobId, kind, options = {}) => {
  const stored = await cache.getStoredTranscript(jobId, kind);
  if (stored) return { content: stored.content, language: stored.detected_language || detectTextLanguage(stored.content) };
  return fetchTranscript(jobId, kind, options);
};
const loadTranscript = async (jobId, kind, options) => (await readTranscript(jobId, kind, options))?.content ?? null;
// The best readable text: any stored kind before contacting the provider.
const loadAnyTranscript = async (jobId, options = {}) => {
  for (const kind of KINDS) {
    const stored = await cache.getTranscript(jobId, kind);
    if (stored !== null) return stored;
  }
  for (const kind of KINDS) {
    const fetched = await fetchTranscript(jobId, kind, options);
    if (fetched) return fetched.content;
  }
  return null;
};
// What EduFusion already stores for a job (without contacting the provider) that
// may seed another lecture: only text the fixed pipeline produced, known from the
// row's format version or, for rows stored without that metadata, the job's.
// Older copies may be English translations of Arabic lectures. `stored` says
// whether any copy, legacy included, is stored at all.
const reusableTranscripts = async (jobId, job) => {
  const fixed = Boolean(formatVersionOf(job));
  const texts = { cleaned: null, raw: null, stored: false };
  for (const kind of KINDS) {
    const row = await cache.getStoredTranscript(jobId, kind);
    if (!row) continue;
    texts.stored = true;
    if (row.format_version || fixed) texts[kind] = row.content;
  }
  return texts;
};
// Copies every kind the provider has and EduFusion lacks; returns the kinds now available.
const persistTranscripts = async (jobId, job, options = {}) => {
  const stored = (await cache.availableKinds([jobId])).get(jobId) || [];
  const fetched = await Promise.all(KINDS.map(async (kind) => (stored.includes(kind)
    || await fetchTranscript(jobId, kind, { ...options, job }) ? kind : null)));
  return fetched.filter(Boolean);
};

// Provider fields merged into saved rows. Requested language, mode and the
// owner's request stay EduFusion's; title and identifiers only fill gaps.
const providerUpdate = (data) => {
  const result = data.result && typeof data.result === 'object' ? data.result : null;
  const detected = detectedOf(data);
  const formatVersion = formatVersionOf(data);
  const patch = {};
  for (const key of STATUS_FIELDS) if (key !== 'submitted_at' && data[key] !== undefined) patch[key] = data[key];
  // The provider reports a queue position only while a job waits; anything else clears a stale one.
  patch.jobs_ahead = data.status === 'queued' && Number.isInteger(data.jobs_ahead) && data.jobs_ahead >= 0 ? data.jobs_ahead : null;
  Object.assign(patch, compact({ detected_language: detected, format_version: formatVersion, video_duration_seconds: data.video_duration_seconds }));
  // The provider reports the produced mode once a job completes (an older provider never does).
  const produced = data.status === 'completed' ? [result?.mode, data.mode].find((value) => MODES.includes(value)) : undefined;
  if (result) patch.result = { has_cleaned: Boolean(result.cleaned_transcript_path), has_raw: Boolean(result.raw_transcript_path),
    ...compact({ detected_language: detected, format_version: formatVersion, mode: produced }) };
  const defaults = compact({ submitted_at: data.submitted_at, title: data.title || result?.title, video_id: data.video_id || result?.video_id,
    youtube_url: data.request?.youtube_url, language: data.language, mode: data.mode });
  return { patch, defaults };
};

// Reconciles one job with the provider for every owner's saved row. A completed
// job's transcripts are stored before returning; a job the provider no longer
// knows is settled from the stored copy or marked lost. Provider outages never
// throw: the saved row is returned with reachable:false.
const syncJob = async (jobId, { user, timeoutMs = 20000 } = {}) => {
  const read = () => (user ? store.getJob(user, jobId) : store.getAnyJob(jobId));
  const saved = await read();
  let response;
  try { response = await requestUpstream(null, jobUrl(jobId), { headers: providerHeaders(user) }, { timeoutMs, maxBytes: 1024 * 1024 }); }
  catch { return { job: saved ?? null, reachable: false }; }
  if (response.status === 404 || response.status === 410) {
    if (!saved && !(user && await store.getAnyJob(jobId))) return { job: null, reachable: true };
    const kinds = (await cache.availableKinds([jobId])).get(jobId) || [];
    if (kinds.length) {
      await store.patchJob(jobId, { status: 'completed', stage: 'completed', error: null,
        result: { ...(saved?.result || {}), has_cleaned: kinds.includes('cleaned'), has_raw: kinds.includes('raw') } });
    } else if (saved?.status !== 'failed') {
      // A failure the provider already reported keeps its own explanation.
      await store.patchJob(jobId, { status: 'failed', stage: 'failed', lost: true, error: saved?.status === 'completed' ? UNSAVED_ERROR : LOST_ERROR,
        finished_at: saved?.finished_at || nowSeconds() });
    }
    return { job: (await read()) ?? null, reachable: true };
  }
  let data;
  try { data = response.ok ? await response.json() : null; } catch { data = null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { job: saved ?? null, reachable: false };
  const { patch, defaults } = providerUpdate(data);
  if (patch.status === 'completed') {
    const kinds = await persistTranscripts(jobId, { ...defaults, ...(saved || await store.getAnyJob(jobId)), ...patch }, { user });
    patch.result = { ...patch.result, has_cleaned: kinds.includes('cleaned') || Boolean(patch.result?.has_cleaned),
      has_raw: kinds.includes('raw') || Boolean(patch.result?.has_raw) };
  }
  const updated = await store.patchJob(jobId, patch, defaults);
  // An administrator may inspect a provider job nobody saved.
  if (!updated) return { job: { job_id: jobId, ...defaults, ...patch, request: data.request }, reachable: true };
  return { job: (await read()) ?? null, reachable: true };
};

// Syncs unfinished jobs (and finished ones `include` selects) in parallel within a
// time budget (serverless requests must answer promptly); jobs not reached in
// time keep their saved state.
const syncPending = async (jobs, { budgetMs = 6000, concurrency = 3, user, include = () => false } = {}) => {
  const list = Array.isArray(jobs) ? jobs : [];
  const pending = [...new Set(list.filter((job) => job?.job_id && (!TERMINAL.has(job.status) || include(job))).map((job) => job.job_id))];
  if (!pending.length) return list;
  const updated = new Map();
  const deadline = Date.now() + budgetMs;
  const timeoutMs = Math.max(1000, Math.min(20000, budgetMs));
  let next = 0;
  const worker = async () => {
    while (next < pending.length && Date.now() < deadline) {
      const jobId = pending[next++];
      try {
        const { job } = await syncJob(jobId, { user, timeoutMs });
        if (job) updated.set(jobId, job);
      } catch (error) { logFailure('Lecture job sync failed:', error); }
    }
  };
  let timer;
  const budget = new Promise((resolve) => { timer = setTimeout(resolve, budgetMs); timer.unref?.(); });
  await Promise.race([Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker)), budget]);
  clearTimeout(timer);
  return list.map((job) => updated.get(job?.job_id) ?? job);
};

const findReusable = ({ videoId: id, language, mode }) => cache.findReusable({ videoId: id, language, mode });

// An identical request still being transcribed, confirmed alive by the provider.
// A job that finished meanwhile is returned completed (its transcripts stored).
const findInflight = async ({ videoId: id, language, mode }, { timeoutMs = 15000 } = {}) => {
  if (!id) return null;
  const candidate = await store.findInflightJob({ videoId: id, language, mode });
  if (!candidate) return null;
  const { job, reachable } = await syncJob(candidate.job_id, { timeoutMs });
  return reachable && job && job.status !== 'failed' ? job : null;
};

const parseOwner = (key) => {
  const match = /^(student|user):(\d{1,9})$/.exec(String(key));
  return match ? { type: match[1], id: Number(match[2]) } : null;
};
const ownerDescriptor = (key, row = {}) => {
  const parsed = parseOwner(key);
  return parsed?.type === 'student'
    ? { owner_key: key, type: 'student', id: parsed.id, name: row?.student_name ?? null, email: row?.email ?? null, role: null }
    : { owner_key: key, type: 'user', id: parsed?.id ?? null, name: row?.username ?? null, email: null, role: row?.role ?? null };
};
// Who saved a lecture: 'student:N' → students, 'user:N' → app_users.
const describeOwners = async (ownerKeys) => {
  const keys = [...new Set((ownerKeys || []).map(String))];
  const ids = (type) => keys.map(parseOwner).filter((owner) => owner?.type === type).map((owner) => owner.id);
  const [students, users] = [ids('student'), ids('user')];
  const [studentRows, userRows] = await Promise.all([
    students.length ? readQuery('SELECT id_student, student_name, email FROM students WHERE id_student = ANY($1::int[])', [students]) : { rows: [] },
    users.length ? readQuery('SELECT id, username, role FROM app_users WHERE id = ANY($1::int[])', [users]) : { rows: [] },
  ]);
  const rows = new Map([...studentRows.rows.map((row) => [`student:${row.id_student}`, row]), ...userRows.rows.map((row) => [`user:${row.id}`, row])]);
  return new Map(keys.map((key) => [key, ownerDescriptor(key, rows.get(key))]));
};

// LectureScribe signs job.finished callbacks with the gateway key that submitted them
// (the trimmed key: it trims its own key list and only ever receives trimmed headers).
const verifyCallback = ({ timestamp, signature, jobId, status }, key = gatewayKey()) => {
  const secret = String(key ?? '').trim();
  if (!secret || typeof timestamp !== 'string' || typeof signature !== 'string' || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds() - Number(timestamp)) > CALLBACK_MAX_SKEW_SECONDS) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${timestamp}.${jobId}.${status}`).digest('hex'));
  const given = Buffer.from(signature.trim().replace(/^sha256=/i, '').toLowerCase());
  return given.length === expected.length && timingSafeEqual(given, expected);
};

// Where LectureScribe should report finished jobs; none without a gateway key
// (callbacks could not be verified) or when this server is not publicly reachable.
const callbackUrl = (req, env = process.env) => {
  if (!gatewayKey(env)) return null;
  const configured = String(env.LECTURESCRIBE_CALLBACK_URL ?? '').trim();
  if (configured) return configured;
  const host = req?.get?.('host');
  if (req?.protocol !== 'https' || !host || /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(host)) return null;
  return `https://${host}/api/lecture-scribe/callback`;
};

// Best-effort human title for a new lecture before the provider reports one.
const lookupTitle = async (youtubeUrl) => {
  try {
    const response = await requestUpstream(null, `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youtubeUrl)}`, {},
      { timeoutMs: 2500, maxBytes: 64 * 1024 });
    if (!response.ok) return null;
    const title = (await response.json())?.title;
    return typeof title === 'string' && title.trim() ? title.trim().slice(0, 300) : null;
  } catch { return null; }
};

module.exports = { KINDS, JOB_ID, LOST_ERROR, UNSAVED_ERROR, STATUS_FIELDS, modeOf, producedModeOf, formatVersionOf, normalizeLanguage,
  detectTextLanguage, providerHeaders, publicJob, missingKinds, awaitingTranscripts, finishedRecently, readTranscript, loadTranscript,
  loadAnyTranscript, reusableTranscripts, persistTranscripts, syncJob, syncPending, findReusable, findInflight, ownerDescriptor, describeOwners,
  verifyCallback, callbackUrl, lookupTitle };
