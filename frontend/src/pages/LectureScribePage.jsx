import PageHeader from '../components/ui/PageHeader';
import StatusBadge from '../components/ui/StatusBadge';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Gauge,
  History,
  Languages,
  ListChecks,
  Loader2,
  MessageSquare,
  Mic,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Users,
  WifiOff,
  X,
  Youtube,
  Zap,
} from 'lucide-react';
import { lectureScribeService } from '../services/api';
import { lectureStudyService } from '../services/lectureStudy';
import { lectureToolsService } from '../services/lectureTools';
import { useAuth } from '../context/AuthContext';
import LectureLibrary, { LectureCourseSelect } from '../components/lectures/LectureLibrary';
import LectureToolsPanel from '../components/lectures/LectureToolsPanel';
import TranscriptView from '../components/lectures/TranscriptView';
import AdminLectureSaves, { StatusPill, formatWhen, languageName, languageText, ownerName } from '../components/lectures/AdminLectureSaves';

const ACTIVE_STATUSES = ['queued', 'running'];
const POLL_MS = 2500;
const POLL_MAX_MS = 10000;
const LIST_REFRESH_MS = 15000;
const HEALTH_RETRY_MS = [10000, 20000]; // health attempts at about 0 s, 10 s and 30 s
const SLOW_HEALTH_MS = 4000;
const JOBS_PER_PAGE = 8;
const LOST_MESSAGE = 'The transcription service restarted before this lecture finished. Submit it again.';
const EMPTY_TRANSCRIPT = { jobId: null, status: 'idle', cleaned: null, raw: null, error: '' };
const CONNECTED = { state: 'ok', message: '' };
const PREFERENCES_KEY = 'edufusion:lecturescribe:preferences';
const SERVICE_BADGES = {
  checking: ['checking', 'Checking service'],
  waking: ['warning', 'Waking up'],
  online: ['online', 'Service online'],
  offline: ['offline', 'Service offline'],
};

const STUDY_CHECK_MS = 8000; // a deep link stops waiting for the study library's status after this
const SUBMIT_RECOVERY_MS = 120000; // how long a reloaded page looks for a lecture whose submission was cut off
const SUBMIT_RECOVERY_POLL_MS = 5000;
const SUBMIT_WAKING = 'The transcription service is waking up or offline. Lectures already in the library still open instantly — try this one again in a minute.';
// Submissions still waiting for the server, per account. They outlive the page, so a
// student who leaves while a cold service wakes up finds the lecture when coming back.
const pendingSubmits = new Map(); // restoreKey -> { promise, request }

const WAITING_NOTES = {
  queued: 'Your lecture is in the queue. You can leave this page — it reopens here when you come back.',
  checking_cache: 'Checking saved results first can skip the full transcription pipeline.',
  downloading: 'The audio is being prepared. You can leave this page; the lecture keeps processing on the server.',
  transcribing: 'Whisper is listening to the lecture in the language it was taught.',
  formatting: 'Headings and paragraphs are being added without translating or changing the lecture.',
  saving: 'The result is being saved so the same lecture opens instantly next time.',
};

const isActiveJob = (job) => ACTIVE_STATUSES.includes(job?.status);
const jobTitle = (job) => job?.title || job?.result?.title || '';
const jobUrl = (job) => job?.youtube_url || job?.request?.youtube_url || '';
const requestedLanguage = (job) => job?.language || job?.request?.language || null;
const detectedLanguage = (job) => job?.detected_language || job?.result?.detected_language || null;
const jobMode = (job) => job?.mode || (job?.request?.clean === false ? 'fast' : 'formatted');
// A formatted request that no model could format comes back as the plain layout; the
// backend reports what was really produced as `produced_mode` (null until it is known).
const producedMode = (job) => job?.produced_mode ?? job?.result?.produced_mode ?? null;
const formattingFellBack = (job) => job?.status === 'completed' && jobMode(job) === 'formatted' && producedMode(job) === 'fast';
const shownMode = (job) => (formattingFellBack(job) ? 'fast' : jobMode(job));
const modeName = (job) => (formattingFellBack(job) ? 'Automatic paragraphs' : jobMode(job) === 'fast' ? 'Fast output' : 'Better formatting');
const jobTime = (job) => {
  const value = job?.submitted_at ?? job?.saved_at ?? job?.created_at;
  const number = Number(value);
  if (value !== null && value !== undefined && Number.isFinite(number)) return number > 1e12 ? number / 1000 : number;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed / 1000;
};
// A student's list holds only their own saves; an administrator's holds every account's, with who saved each.
const ownsJob = (job, ownerKey) => !ownerKey || (Array.isArray(job?.saved_by) && job.saved_by.some((owner) => owner?.owner_key === ownerKey));
// Lectures still processing stay on top, then the newest first.
const sortJobs = (list) => [...list].sort((a, b) => (isActiveJob(b) - isActiveJob(a)) || (jobTime(b) - jobTime(a)));

const formatSeconds = (value) => {
  const seconds = Math.max(0, Math.round(value || 0));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

// Transcript requests use responseType 'text', so an error body arrives as a JSON string.
const errorMessage = (error, fallback) => {
  let data = error?.response?.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch {
      const text = data.trim();
      return text && text.length <= 300 && !text.startsWith('<') ? text : fallback;
    }
  }
  if (typeof data?.detail === 'string') return data.detail;
  if (typeof data?.error === 'string') return data.error;
  return fallback;
};
const isCanceled = (error) => error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || error?.name === 'AbortError';
const isTransient = (error) => [502, 503, 504].includes(error?.response?.status)
  || (!error?.response && (Boolean(error?.isAxiosError) || ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'].includes(error?.code)));
const submitErrorText = (error) => (isTransient(error) ? SUBMIT_WAKING : errorMessage(error, 'Unable to submit this lecture. Check the link and try again.'));
// A queued lecture has not started, so it shows its place in the queue instead of a stage countdown.
const queueText = (job) => {
  const ahead = job?.jobs_ahead;
  if (typeof ahead !== 'number' || !Number.isFinite(ahead) || ahead < 0) return '';
  const count = Math.round(ahead);
  return count > 0 ? `${count} ${count === 1 ? 'lecture is' : 'lectures are'} ahead of yours` : 'Next in line';
};

const restoreKeyFor = (user) => `edufusion:lecturescribe:active:${user?.role || 'guest'}:${user?.id ?? 'anonymous'}`;
const readSession = (key) => { try { return sessionStorage.getItem(key); } catch { return null; } };
const writeSession = (key, value) => {
  try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); } catch { /* storage can be blocked */ }
};
// Set while a submission waits for the server; a reload in that window looks for the lecture afterwards.
const submitMarkerKey = (restoreKey) => `${restoreKey}:submitting`;
const readSubmitMarker = (key) => {
  try {
    const marker = JSON.parse(readSession(key) || 'null');
    return Number.isFinite(marker?.at) && Date.now() - marker.at < SUBMIT_RECOVERY_MS ? marker : null;
  } catch { return null; }
};
const readPreferences = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}');
    return { language: ['auto', 'ar', 'en'].includes(saved.language) ? saved.language : 'auto', mode: saved.mode === 'fast' ? 'fast' : 'formatted' };
  } catch { return { language: 'auto', mode: 'formatted' }; }
};
const savedByText = (owners, count) => {
  const names = owners.map(ownerName);
  const shown = names.slice(0, 2);
  const extra = Math.max(count, names.length) - shown.length;
  return shown.join(', ') + (extra > 0 ? ` +${extra}` : '');
};

// The countdown ticks on its own so the rest of the page does not re-render every second.
const StageCountdown = memo(function StageCountdown({ startedAt, estimate }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(0, estimate - (now / 1000 - startedAt));
  return <span className="font-medium text-light-accent tabular-nums">{remaining > 0 ? formatSeconds(remaining) : 'finishing up'}</span>;
});

const chip = 'inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-light-accent/75';
const toolButton = 'inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm hover:border-secondary disabled:opacity-40';
const rowAction = 'inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2 py-1.5 text-xs hover:border-secondary disabled:opacity-40';

export default function LectureScribePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const restoreKey = restoreKeyFor(user);
  const markerKey = submitMarkerKey(restoreKey);
  // Administrators list every account's lectures; only their own saves open by themselves.
  const ownerKey = isAdmin ? `user:${user?.id}` : null;
  const [searchParams, setSearchParams] = useSearchParams();
  const jobParam = searchParams.get('job') || null;
  const toolParam = searchParams.get('tool');

  const [studyEnabled, setStudyEnabled] = useState(false);
  // Whether the study library has answered (or stopped being waited for): deep links wait for it.
  const [studyChecked, setStudyChecked] = useState(false);
  const [toolsStatus, setToolsStatus] = useState('checking');
  const [toolsJob, setToolsJob] = useState(null);
  const [studyEnrollment, setStudyEnrollment] = useState(null);
  const [studyTitle, setStudyTitle] = useState('');
  const [focusLecture, setFocusLecture] = useState(null);
  const studyRequests = useRef(new Map());

  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [mode, setMode] = useState(() => readPreferences().mode);
  const [language, setLanguage] = useState(() => readPreferences().language);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [serviceStatus, setServiceStatus] = useState('checking');

  const [jobs, setJobs] = useState([]);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [jobsError, setJobsError] = useState('');
  const [jobWarning, setJobWarning] = useState('');
  const [jobSearch, setJobSearch] = useState('');
  const [jobFilter, setJobFilter] = useState('all');
  const [jobPage, setJobPage] = useState(0);

  const [activeJob, setActiveJob] = useState(null);
  const [connection, setConnection] = useState(CONNECTED);
  const [transcript, setTranscript] = useState(EMPTY_TRANSCRIPT);
  const [viewerKey, setViewerKey] = useState(0);

  const mounted = useRef(true);
  const healthRun = useRef(0);
  const healthTimer = useRef(null);
  const transcriptRef = useRef(EMPTY_TRANSCRIPT);
  const transcriptSeq = useRef(0);
  const transcriptAbort = useRef(null);
  const pendingTool = useRef(null);
  const restored = useRef(false);
  const autoPicked = useRef(false);
  const firstLoad = useRef(null);
  const listed = useRef(false); // the saved list has loaded at least once
  const scrollOnOpen = useRef(false);
  const viewerRef = useRef(null);
  // Latest values for callbacks that must keep a stable identity.
  const jobsRef = useRef(jobs);
  const activeRef = useRef(activeJob);
  const viewedRef = useRef(jobParam);
  const setParamsRef = useRef(setSearchParams);
  jobsRef.current = jobs;
  activeRef.current = activeJob;
  viewedRef.current = jobParam;
  setParamsRef.current = setSearchParams;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; transcriptAbort.current?.abort(); };
  }, []);

  const updateParams = useCallback((change) => {
    setParamsRef.current((params) => { const next = new URLSearchParams(params); change(next); return next; }, { replace: true });
  }, []);

  // Provider health only drives a banner; it never hides saved lectures or the open job.
  const checkService = useCallback(async () => {
    const run = ++healthRun.current;
    clearTimeout(healthTimer.current);
    setServiceStatus('checking');
    const slow = setTimeout(() => { if (run === healthRun.current) setServiceStatus((status) => (status === 'checking' ? 'waking' : status)); }, SLOW_HEALTH_MS);
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await lectureScribeService.health();
          if (run === healthRun.current) setServiceStatus('online');
          return true;
        } catch {
          if (run !== healthRun.current) return false;
        }
        if (attempt >= HEALTH_RETRY_MS.length) { setServiceStatus('offline'); return false; }
        setServiceStatus('waking');
        await new Promise((resolve) => { healthTimer.current = setTimeout(resolve, HEALTH_RETRY_MS[attempt]); });
        if (run !== healthRun.current) return false;
      }
    } finally { clearTimeout(slow); }
  }, []);
  // Any provider-backed success proves the service is up again.
  const markOnline = useCallback(() => {
    healthRun.current += 1;
    clearTimeout(healthTimer.current);
    setServiceStatus('online');
  }, []);
  useEffect(() => {
    checkService();
    return () => { healthRun.current += 1; clearTimeout(healthTimer.current); };
  }, [checkService]);

  useEffect(() => {
    let alive = true;
    lectureToolsService.status()
      .then(({ data }) => { if (alive) setToolsStatus(data?.enabled ? 'enabled' : 'disabled'); })
      .catch(() => { if (alive) setToolsStatus('disabled'); });
    return () => { alive = false; };
  }, []);
  const onStudyAvailability = useCallback((value) => { setStudyEnabled(value); setStudyChecked(true); }, []);
  // The library reports only a successful status check, so a failed one cannot hold a deep link forever.
  useEffect(() => {
    const timer = setTimeout(() => setStudyChecked(true), STUDY_CHECK_MS);
    return () => clearTimeout(timer);
  }, []);

  const loadJobs = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoadingJobs(true);
    try {
      const { data } = await lectureScribeService.listJobs();
      if (!mounted.current) return;
      const incoming = (Array.isArray(data?.jobs) ? data.jobs : []).filter((job) => typeof job?.job_id === 'string' && job.job_id);
      listed.current = true;
      setJobs((current) => {
        const ids = new Set(incoming.map((job) => job.job_id));
        // A lecture submitted a moment ago stays listed even if this response was read before it was saved.
        return sortJobs([...current.filter((job) => job.local && !ids.has(job.job_id)), ...incoming]);
      });
      setJobWarning(data?.warning || '');
      setJobsError('');
      return incoming;
    } catch (error) {
      if (mounted.current && !quiet) setJobsError(errorMessage(error, 'Your lectures could not be loaded right now.'));
      return null;
    } finally {
      if (mounted.current) { setLoadingJobs(false); setJobsLoaded(true); }
    }
  }, []);
  useEffect(() => { firstLoad.current = loadJobs(); }, [loadJobs]);
  const hasActiveJobs = jobs.some(isActiveJob);
  useEffect(() => {
    if (!hasActiveJobs) return undefined;
    const timer = setInterval(() => { if (!document.hidden) loadJobs({ quiet: true }); }, LIST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [hasActiveJobs, loadJobs]);

  const patchJob = useCallback((job) => {
    setJobs((list) => list.map((row) => {
      if (row.job_id !== job.job_id) return row;
      const next = { ...row, ...job };
      delete next.provider_unavailable;
      return next;
    }));
  }, []);

  const setTranscriptState = useCallback((next) => { transcriptRef.current = next; setTranscript(next); }, []);
  // Loads both kinds; a response for a lecture that is no longer open is dropped.
  const loadTranscripts = useCallback(async (job, { force = false } = {}) => {
    const jobId = job?.job_id;
    if (!jobId) return;
    const current = transcriptRef.current;
    if (!force && current.jobId === jobId && ['loading', 'ready', 'empty'].includes(current.status)) return;
    const token = ++transcriptSeq.current;
    transcriptAbort.current?.abort();
    const controller = new AbortController();
    transcriptAbort.current = controller;
    setTranscriptState({ ...EMPTY_TRANSCRIPT, jobId, status: 'loading' });
    const wantCleaned = job.result?.has_cleaned ?? (job.result ? Boolean(job.result.cleaned_transcript_path) : true);
    const wantRaw = job.result?.has_raw !== false;
    const fetchKind = async (kind) => String((await lectureScribeService.getTranscript(jobId, kind, { signal: controller.signal })).data ?? '');
    const [cleaned, raw] = await Promise.allSettled([wantCleaned ? fetchKind('cleaned') : null, wantRaw ? fetchKind('raw') : null]);
    if (token !== transcriptSeq.current || viewedRef.current !== jobId || !mounted.current) return;
    const text = (result) => (result.status === 'fulfilled' && result.value?.trim() ? result.value : null);
    if (text(cleaned) || text(raw)) {
      setTranscriptState({ jobId, status: 'ready', cleaned: text(cleaned), raw: text(raw), error: '' });
      return;
    }
    const failures = [cleaned, raw].filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (failures.some(isCanceled)) return;
    const failure = failures.find((error) => error?.response?.status !== 404) || failures[0];
    setTranscriptState(failure
      ? { ...EMPTY_TRANSCRIPT, jobId, status: 'error', error: errorMessage(failure, 'The transcript could not be loaded.') }
      : { ...EMPTY_TRANSCRIPT, jobId, status: 'empty' });
  }, [setTranscriptState]);

  const selectJob = useCallback((jobId, { scroll = true } = {}) => {
    if (!jobId) return;
    scrollOnOpen.current = scroll;
    if (jobId === viewedRef.current) { setViewerKey((key) => key + 1); return; }
    updateParams((next) => { next.set('job', jobId); next.delete('tool'); });
  }, [updateParams]);
  const closeViewer = () => {
    writeSession(restoreKey, null);
    transcriptSeq.current += 1;
    transcriptAbort.current?.abort();
    setTranscriptState(EMPTY_TRANSCRIPT);
    setActiveJob(null);
    setConnection(CONNECTED);
    updateParams((next) => { next.delete('job'); next.delete('tool'); });
  };

  // The open lecture lives in the URL and, per account, in this tab's session so it survives navigation.
  useEffect(() => { if (jobParam) writeSession(restoreKey, jobParam); }, [jobParam, restoreKey]);
  useEffect(() => {
    if (toolParam !== null) {
      // Deep links from Oral Exam: remember the tool, then clear it so a refresh does not reopen it.
      if (jobParam && ['chat', 'quiz'].includes(toolParam)) pendingTool.current = { jobId: jobParam, tab: toolParam };
      updateParams((next) => next.delete('tool'));
      return;
    }
    if (restored.current) return;
    restored.current = true;
    if (!jobParam) {
      const stored = readSession(restoreKey);
      if (stored) selectJob(stored, { scroll: false });
    }
  }, [jobParam, toolParam, restoreKey, selectJob, updateParams]);
  useEffect(() => {
    if (!jobsLoaded || autoPicked.current) return;
    autoPicked.current = true;
    if (viewedRef.current || readSession(restoreKey)) return;
    const running = jobs.find((job) => isActiveJob(job) && ownsJob(job, ownerKey));
    if (running) selectJob(running.job_id, { scroll: false });
  }, [jobsLoaded, jobs, restoreKey, ownerKey, selectJob]);
  useEffect(() => {
    if (!jobParam || !scrollOnOpen.current) return;
    scrollOnOpen.current = false;
    const viewer = viewerRef.current;
    // Scroll only the workspace pane: scrollIntoView would also shift the fixed app shell.
    const pane = viewer?.closest('#workspace-content');
    if (pane?.scrollTo) pane.scrollTo({ top: pane.scrollTop + viewer.getBoundingClientRect().top - pane.getBoundingClientRect().top - 16, behavior: 'smooth' });
    else viewer?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [jobParam, viewerKey]);

  // Follows the open lecture. Transient failures keep the panel and retry with backoff.
  useEffect(() => {
    const jobId = jobParam;
    if (!jobId) { setActiveJob(null); setConnection(CONNECTED); return undefined; }
    let cancelled = false;
    let finished = false;
    let inFlight = false;
    let timer = null;
    let controller = null;
    let delay = POLL_MS;
    const known = activeRef.current?.job_id === jobId ? activeRef.current : jobsRef.current.find((job) => job.job_id === jobId) || null;
    let sawActive = isActiveJob(known);
    setActiveJob(known);
    setConnection(CONNECTED);
    if (transcriptRef.current.jobId !== jobId) {
      transcriptSeq.current += 1;
      transcriptAbort.current?.abort();
      setTranscriptState(EMPTY_TRANSCRIPT);
    }
    if (known?.status === 'completed') loadTranscripts(known);

    const schedule = (ms) => { clearTimeout(timer); if (!cancelled && !finished) timer = setTimeout(tick, ms); };
    const backoff = () => { schedule(delay); delay = Math.min(POLL_MAX_MS, delay * 2); };
    const missing = async () => {
      let current = activeRef.current?.job_id === jobId ? activeRef.current : jobsRef.current.find((job) => job.job_id === jobId);
      // The saved list may still be loading: it decides between "interrupted" and "not found".
      if (!current && firstLoad.current) current = (await firstLoad.current)?.find((job) => job.job_id === jobId);
      if (cancelled) return;
      if (isActiveJob(current)) {
        const lost = { ...current, status: 'failed', lost: true, error: LOST_MESSAGE };
        setActiveJob(lost); patchJob(lost); setConnection(CONNECTED);
      } else if (current) {
        setConnection({ state: 'error', message: 'This lecture could not be refreshed. It may have been removed.' });
      } else {
        writeSession(restoreKey, null);
        setActiveJob(null);
        toast.error('That lecture could not be found.', { id: 'lecture-missing' });
        updateParams((next) => { next.delete('job'); next.delete('tool'); });
      }
    };
    async function tick() {
      if (cancelled || finished || inFlight || document.hidden) return;
      inFlight = true;
      controller = new AbortController();
      try {
        const { data } = await lectureScribeService.getJob(jobId, { signal: controller.signal });
        if (cancelled) return;
        const previous = activeRef.current?.job_id === jobId ? activeRef.current : {};
        const job = { ...previous, ...data, job_id: data?.job_id || jobId, provider_unavailable: Boolean(data?.provider_unavailable) };
        setActiveJob(job);
        patchJob(job);
        if (isActiveJob(job)) {
          sawActive = true;
          if (job.provider_unavailable) { setConnection({ state: 'reconnecting', message: '' }); backoff(); }
          else { setConnection(CONNECTED); markOnline(); delay = POLL_MS; schedule(delay); }
          return;
        }
        finished = true;
        setConnection(CONNECTED);
        if (job.status === 'completed') {
          loadTranscripts(job);
          if (sawActive) { toast.success('Transcript is ready', { id: `lecture-ready-${jobId}` }); loadJobs({ quiet: true }); }
        } else if (job.status === 'failed' && sawActive) {
          toast.error(job.error || 'Transcription failed', { id: `lecture-failed-${jobId}` });
          loadJobs({ quiet: true });
        }
      } catch (error) {
        if (cancelled) return;
        if (isCanceled(error)) { if (!document.hidden) schedule(delay); return; }
        const status = error?.response?.status;
        // 400 is a malformed id (a mangled link): it can never succeed, like an unknown one.
        if (status === 400 || status === 404 || status === 410) { finished = true; missing(); return; }
        if (status === 401 || status === 403) {
          finished = true;
          setConnection({ state: 'error', message: errorMessage(error, 'You do not have access to this lecture.') });
          return;
        }
        setConnection({ state: 'reconnecting', message: isTransient(error) ? '' : errorMessage(error, '') });
        backoff();
      } finally { inFlight = false; }
    }
    const onVisibility = () => {
      if (document.hidden) { clearTimeout(timer); controller?.abort(); }
      else if (!finished && !inFlight) tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [jobParam, viewerKey, restoreKey, loadTranscripts, loadJobs, markOnline, patchJob, setTranscriptState, updateParams]);

  const openStudyTool = useCallback(async (job, tab) => {
    if (!studyEnabled) {
      if (toolsStatus === 'enabled') { setToolsJob({ job, tab }); return; }
      toast.error('Lecture study tools are awaiting server setup.');
      return;
    }
    const signature = 'import:' + job.job_id;
    const key = studyRequests.current.get(signature) || crypto.randomUUID();
    studyRequests.current.set(signature, key);
    try {
      const { data } = await lectureStudyService.import(job.job_id, key);
      studyRequests.current.delete(signature);
      setFocusLecture({ id: data.lecture.id, tab });
    } catch (error) { toast.error(errorMessage(error, 'Unable to prepare lecture tools')); }
  }, [studyEnabled, toolsStatus]);
  const closeTools = useCallback(() => setToolsJob(null), []);
  // A lecture opened before the saved list arrived shows its saved row while the server is asked.
  useEffect(() => {
    if (!jobParam || activeRef.current) return;
    const row = jobs.find((job) => job.job_id === jobParam);
    if (!row) return;
    setActiveJob(row);
    if (row.status === 'completed') loadTranscripts(row);
  }, [jobs, jobParam, loadTranscripts]);
  // Both tool backends must have answered first: the study library alone may be the one available.
  useEffect(() => {
    const pending = pendingTool.current;
    if (!pending || toolsStatus === 'checking' || !studyChecked || activeJob?.job_id !== pending.jobId) return;
    pendingTool.current = null;
    if (activeJob.status === 'completed') openStudyTool(activeJob, pending.tab);
  }, [activeJob, toolsStatus, studyChecked, openStudyTool]);

  useEffect(() => {
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ language, mode })); } catch { /* preference only */ }
  }, [language, mode]);

  // Lists, opens and follows a lecture the server accepted.
  const showSubmitted = useCallback((data, request, { scroll = true } = {}) => {
    // The server fills unknown fields with null, so defaults are applied per field.
    const status = data.status || 'queued';
    const job = {
      ...data, status, stage: data.stage || status,
      stage_label: data.stage_label || (status === 'queued' ? 'Waiting to start.' : null),
      progress_percent: data.progress_percent ?? 0, submitted_at: data.submitted_at ?? Date.now() / 1000,
      youtube_url: data.youtube_url || request.youtube_url, language: data.language || request.language,
      mode: data.mode || (request.clean ? 'formatted' : 'fast'),
      request: data.request?.youtube_url ? data.request : request,
    };
    if (job.cached && job.status === 'completed') toast.success('This lecture was already transcribed — loaded instantly');
    else if (job.shared) toast.success('This lecture is already being transcribed — you will get the same transcript');
    else { toast.success('Lecture submitted'); markOnline(); }
    setActiveJob(job);
    setJobs((list) => sortJobs([{ ...job, local: true }, ...list.filter((row) => row.job_id !== job.job_id)]));
    selectJob(job.job_id, { scroll });
    loadJobs({ quiet: true });
  }, [loadJobs, markOnline, selectJob]);

  const createTranscript = async ({ url, language: lectureLanguage, mode: lectureMode }) => {
    setSubmitting(true);
    setSubmitError('');
    const request = { youtube_url: url, clean: lectureMode === 'formatted', language: lectureLanguage };
    writeSession(markerKey, JSON.stringify({ at: Date.now(), language: lectureLanguage, mode: lectureMode,
      known: listed.current ? jobsRef.current.map((job) => job.job_id) : null }));
    // A cold service can take a minute to answer. The outcome is recorded whether or not this
    // page is still open, and a page opened meanwhile picks the same submission up.
    const promise = lectureScribeService.createJob(request).then(({ data }) => {
      if (typeof data?.job_id === 'string' && data.job_id) writeSession(restoreKey, data.job_id);
      return data;
    }).finally(() => writeSession(markerKey, null));
    const submission = { promise, request };
    pendingSubmits.set(restoreKey, submission);
    promise.finally(() => { if (pendingSubmits.get(restoreKey) === submission) pendingSubmits.delete(restoreKey); }).catch(() => {});
    try {
      const data = await promise;
      if (!mounted.current) return false;
      if (typeof data?.job_id !== 'string' || !data.job_id) throw new Error('No lecture job was returned');
      showSubmitted(data, request);
      return true;
    } catch (error) {
      if (!mounted.current) return false;
      if (isTransient(error) && serviceStatus === 'online') checkService();
      setSubmitError(submitErrorText(error));
      return false;
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  };
  // Coming back while a submission still waits for the server: it opens here once accepted.
  useEffect(() => {
    const submission = pendingSubmits.get(restoreKey);
    if (!submission) return undefined;
    let alive = true;
    setSubmitting(true);
    submission.promise.then((data) => {
      if (!alive) return;
      if (typeof data?.job_id === 'string' && data.job_id) showSubmitted(data, submission.request, { scroll: false });
      else setSubmitError(submitErrorText(null));
    }, (error) => { if (alive) setSubmitError(submitErrorText(error)); })
      .finally(() => { if (alive) setSubmitting(false); });
    return () => { alive = false; };
  }, [restoreKey, showSubmitted]);
  // A reload during a slow submission loses its answer, but the server still saves the lecture:
  // the list is checked for a while for a new lecture with the submitted language and mode.
  useEffect(() => {
    if (pendingSubmits.has(restoreKey)) return undefined;
    const marker = readSubmitMarker(markerKey);
    if (!marker) { writeSession(markerKey, null); return undefined; }
    let stopped = false;
    let timer = null;
    const known = Array.isArray(marker.known) ? new Set(marker.known) : null;
    // Not listed when the submission started; without a list from then, saved after it started
    // (a minute of slack covers a device clock that runs ahead of the server's).
    const matches = (job) => requestedLanguage(job) === marker.language && jobMode(job) === marker.mode && ownsJob(job, ownerKey)
      && (known ? !known.has(job.job_id) : jobTime(job) >= marker.at / 1000 - 60);
    const settle = (list) => {
      const found = list?.find(matches);
      if (found) selectJob(found.job_id, { scroll: false });
      if (!found && Date.now() - marker.at < SUBMIT_RECOVERY_MS) return false;
      writeSession(markerKey, null);
      return true;
    };
    const poll = async () => {
      const list = await loadJobs({ quiet: true });
      if (!stopped && !settle(list)) timer = setTimeout(poll, SUBMIT_RECOVERY_POLL_MS);
    };
    Promise.resolve(firstLoad.current).then((first) => {
      if (!stopped && !settle(first)) timer = setTimeout(poll, SUBMIT_RECOVERY_POLL_MS);
    });
    return () => { stopped = true; clearTimeout(timer); };
  }, [restoreKey, markerKey, ownerKey, loadJobs, selectJob]);

  const submitJob = async (event) => {
    event.preventDefault();
    const url = youtubeUrl.trim();
    if (!url) { setSubmitError('Enter a YouTube lecture URL.'); return; }
    if (studyEnabled) {
      setSubmitting(true);
      setSubmitError('');
      try {
        const body = { youtube_url: url, language, enrollment_id: studyEnrollment, ...(studyTitle.trim() ? { title: studyTitle.trim() } : {}) };
        const signature = JSON.stringify(body);
        const key = studyRequests.current.get(signature) || crypto.randomUUID();
        studyRequests.current.set(signature, key);
        const { data } = await lectureStudyService.create(body, key);
        studyRequests.current.delete(signature);
        setFocusLecture({ id: data.lecture.id, tab: 'summary' });
        setStudyTitle('');
        setYoutubeUrl('');
        toast.success('Lecture saved. Preparation continues in the background.');
      } catch (error) {
        setSubmitError(errorMessage(error, 'Unable to save this lecture.'));
      } finally { setSubmitting(false); }
      return;
    }
    if (await createTranscript({ url, language, mode })) setYoutubeUrl('');
  };
  const resubmit = async (job) => {
    const url = jobUrl(job);
    if (!url) { toast.error('The lecture link is missing — paste it into the form to submit it again.'); return; }
    const lectureLanguage = ['auto', 'ar', 'en'].includes(requestedLanguage(job)) ? requestedLanguage(job) : 'auto';
    const lectureMode = jobMode(job);
    setYoutubeUrl(url); setLanguage(lectureLanguage); setMode(lectureMode);
    if (await createTranscript({ url, language: lectureLanguage, mode: lectureMode })) setYoutubeUrl('');
  };

  const lectureToolsReady = studyEnabled || toolsStatus === 'enabled';
  const processing = jobs.filter((job) => isActiveJob(job) && job.job_id !== jobParam);
  const filteredJobs = useMemo(() => {
    const needle = jobSearch.trim().toLowerCase();
    return jobs.filter((job) => {
      if (jobFilter === 'active' && !isActiveJob(job)) return false;
      if (['completed', 'failed'].includes(jobFilter) && job.status !== jobFilter) return false;
      if (!needle) return true;
      const owners = (job.saved_by || []).map((owner) => `${ownerName(owner)} ${owner.id ?? ''} ${owner.email || ''}`).join(' ');
      return `${job.job_id} ${jobTitle(job)} ${jobUrl(job)} ${owners}`.toLowerCase().includes(needle);
    });
  }, [jobs, jobSearch, jobFilter]);
  const jobPages = Math.max(1, Math.ceil(filteredJobs.length / JOBS_PER_PAGE));
  const currentJobPage = Math.min(jobPage, jobPages - 1);

  const isActive = isActiveJob(activeJob);
  const progress = Math.max(0, Math.min(100, Math.round(activeJob?.progress_percent || 0)));
  const viewedRow = jobs.find((job) => job.job_id === jobParam);
  const savedBy = activeJob?.saved_by || viewedRow?.saved_by || [];
  const requested = requestedLanguage(activeJob);
  const detected = detectedLanguage(activeJob);
  const languageMismatch = activeJob?.status === 'completed' && ['ar', 'en'].includes(requested) && detected && detected !== requested;
  const viewedTranscript = transcript.jobId === activeJob?.job_id ? transcript : EMPTY_TRANSCRIPT;
  const [badgeTone, badgeLabel] = SERVICE_BADGES[serviceStatus];
  const viewerHeading = !activeJob ? 'Opening lecture'
    : activeJob.status === 'completed' ? 'Transcript ready'
      : activeJob.lost ? 'Lecture interrupted'
        : activeJob.status === 'failed' ? 'Job failed' : 'Processing lecture';

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      <PageHeader title="LectureScribe" icon={Youtube} tone="peach" description="Turn a YouTube lecture into readable notes in the language it was taught, ready to revisit at your own pace.">
        {processing.length > 0 && <button type="button" onClick={() => selectJob(processing[0].job_id)}
          className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          {processing.length} lecture{processing.length === 1 ? '' : 's'} processing
        </button>}
        <StatusBadge status={badgeTone}>{badgeLabel}</StatusBadge>
      </PageHeader>

      {serviceStatus === 'waking' && <div role="status" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin" aria-hidden="true" />
        <div>
          <p className="font-semibold">Waking up the transcription service…</p>
          <p className="mt-0.5 text-amber-800">Free hosting can take up to a minute to start. Your saved lectures are below, and you can still submit a lecture.</p>
        </div>
      </div>}
      {serviceStatus === 'offline' && <div role="status" className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center">
        <WifiOff size={18} className="shrink-0" aria-hidden="true" />
        <div className="flex-1">
          <p className="font-semibold">The transcription service is offline — saved lectures are still available.</p>
          <p className="mt-0.5 text-red-700">Lectures already in the library still open instantly. New transcriptions may fail until the service is back.</p>
        </div>
        <button type="button" onClick={checkService} className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 font-semibold text-red-700 hover:bg-red-100">
          <RefreshCw size={15} aria-hidden="true" />Retry
        </button>
      </div>}

      <LectureLibrary focusLecture={focusLecture} onAvailabilityChange={onStudyAvailability} />

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <form onSubmit={submitJob} className="glass glow-border p-5 md:p-6 space-y-6">
          <div>
            <label htmlFor="lecture-url" className="block text-sm font-semibold text-light-accent mb-2">
              YouTube lecture URL
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Youtube className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-red-500" aria-hidden="true" />
                <input
                  id="lecture-url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  dir="ltr"
                  value={youtubeUrl}
                  onChange={(event) => { setYoutubeUrl(event.target.value); setSubmitError(''); }}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="w-full h-12 border border-border bg-white pl-12 pr-4 text-sm text-light-accent outline-none transition-colors focus:border-accent"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="h-12 px-6 bg-secondary text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {submitting ? 'Submitting' : studyEnabled ? 'Save lecture' : 'Create transcript'}
              </button>
            </div>
            {submitError && <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{submitError}
            </p>}
          </div>

          <div>
            <label htmlFor="lecture-language" className="block text-sm font-semibold text-light-accent">Lecture language</label>
            <select id="lecture-language" value={language} onChange={(event) => setLanguage(event.target.value)}
              className="mt-2 block h-11 w-full max-w-xs border border-border bg-white px-3 text-sm">
              <option value="auto">Detect automatically</option>
              <option value="ar">Arabic — العربية</option>
              <option value="en">English</option>
            </select>
            <p className="mt-2 text-xs leading-relaxed text-light-accent/55">The transcript stays in the language that was spoken — nothing is translated.</p>
          </div>
          <LectureCourseSelect enabled={studyEnabled} value={studyEnrollment} onChange={setStudyEnrollment} />
          {studyEnabled && <label className="block text-sm font-semibold">Lecture title (optional)<input maxLength={200} value={studyTitle} onChange={(event) => setStudyTitle(event.target.value)} className="w-full mt-2 border border-border p-3" placeholder="For example: Networks — Lecture 3" /></label>}
          {studyEnabled ? <p className="text-sm text-light-accent/60">Saves a formatted transcript, a summary of every section, and lecture tools to your library. Processing continues when the worker is available.</p> : <fieldset>
            <legend className="text-sm font-semibold text-light-accent mb-3">Processing mode</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 border border-border">
              {[
                ['fast', 'Fast output', 'Whisper transcript with automatic paragraphs (no AI rewriting).', Zap, 'bg-amber-100 text-amber-700'],
                ['formatted', 'Better formatting', 'AI formatting with headings and paragraphs, kept in the lecture’s own language.', Sparkles, 'bg-teal-100 text-teal-700'],
              ].map(([value, label, description, Icon, tone], index) => <label key={value}
                className={`relative cursor-pointer p-4 transition-colors ${index === 0 ? 'border-b md:border-b-0 md:border-r border-border' : ''} ${mode === value ? 'bg-secondary/15' : 'bg-white hover:bg-secondary/5'}`}>
                <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="sr-only peer" />
                <span className="flex items-start gap-3 rounded-lg peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-secondary">
                  <span className={`w-9 h-9 ${tone} flex items-center justify-center flex-shrink-0`}><Icon className="w-4 h-4" /></span>
                  <span>
                    <span className="flex items-center gap-2 text-sm font-semibold text-light-accent">
                      {label}
                      {mode === value && <Check className="w-4 h-4 text-accent" />}
                    </span>
                    <span className="block text-xs leading-relaxed text-light-accent/60 mt-1">{description}</span>
                  </span>
                </span>
              </label>)}
            </div>
          </fieldset>}
        </form>

        <aside className="glass glow-border flex min-w-0 flex-col p-5" aria-labelledby="lecture-jobs-heading">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="min-w-0">
              <p className="text-xs font-mono uppercase text-light-accent/45">{isAdmin ? 'Across all accounts' : 'Your lectures'}</p>
              <h2 id="lecture-jobs-heading" className="font-display text-lg font-semibold text-light-accent mt-1">{isAdmin ? 'All lecture transcriptions' : 'Previous jobs'}</h2>
            </div>
            <button
              type="button"
              onClick={() => loadJobs()}
              disabled={loadingJobs}
              className="w-10 h-10 shrink-0 rounded-lg border border-border bg-white text-light-accent/60 hover:text-accent disabled:opacity-50 inline-flex items-center justify-center"
              aria-label="Refresh previous jobs"
              title="Refresh previous jobs"
            >
              <RefreshCw className={`w-4 h-4 ${loadingJobs ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {jobWarning && <p role="status" className="text-sm text-amber-700 mb-3">{jobWarning}</p>}
          {jobsError && <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <span>{jobsError}</span>
            <button type="button" onClick={() => loadJobs()} className="shrink-0 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold">Retry</button>
          </div>}
          <div className="grid grid-cols-1 gap-2 mb-3 sm:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-1">
            <input aria-label="Search lecture transcriptions" placeholder={isAdmin ? 'Search title, link or student' : 'Search title or link'} value={jobSearch}
              onChange={(event) => { setJobSearch(event.target.value); setJobPage(0); }} className="w-full rounded-lg border border-border p-2 text-sm" />
            <select aria-label="Transcription status" value={jobFilter} onChange={(event) => { setJobFilter(event.target.value); setJobPage(0); }}
              className="w-full rounded-lg border border-border p-2 text-sm">
              <option value="all">All statuses</option><option value="active">In progress</option>
              <option value="completed">Completed</option><option value="failed">Failed</option>
            </select>
          </div>
          <ul className="space-y-2 max-h-[460px] overflow-y-auto pr-1" aria-label="Lecture transcriptions">
            {filteredJobs.slice(currentJobPage * JOBS_PER_PAGE, currentJobPage * JOBS_PER_PAGE + JOBS_PER_PAGE).map((job) => {
              const title = jobTitle(job);
              const url = jobUrl(job);
              const selected = job.job_id === jobParam;
              const owners = Array.isArray(job.saved_by) ? job.saved_by : [];
              const languageLabel = languageText(requestedLanguage(job), detectedLanguage(job));
              const when = formatWhen(jobTime(job) || null);
              return <li key={job.job_id}>
                <article className={`rounded-xl border bg-white p-3 transition-colors ${selected ? 'border-secondary ring-1 ring-secondary/30' : 'border-border hover:border-secondary/60'}`}>
                  <button type="button" className="block w-full text-start" onClick={() => selectJob(job.job_id)} aria-current={selected ? 'true' : undefined}>
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-left text-sm font-semibold text-light-accent" dir="auto">{title || url || job.job_id}</span>
                        {title && url && <span className="block truncate text-xs text-light-accent/50" dir="ltr">{url}</span>}
                      </span>
                      <StatusPill status={job.status} lost={job.lost} />
                    </span>
                    {isActiveJob(job) && <span className="mt-2 block">
                      <span className="block h-1 overflow-hidden rounded-full bg-surface-2"><span className="block h-full bg-secondary transition-all" style={{ width: `${Math.max(3, Math.min(100, job.progress_percent || 0))}%` }} /></span>
                      {job.stage_label && <span className="mt-1 block truncate text-xs text-light-accent/60">{job.stage_label}</span>}
                    </span>}
                    <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-light-accent/55">
                      {languageLabel && <span className="inline-flex items-center gap-1"><Languages size={12} aria-hidden="true" />{languageLabel}</span>}
                      <span>{modeName(job)}</span>
                      {when && <span>{when}</span>}
                    </span>
                    {isAdmin && owners.length > 0 && <span className="mt-1.5 flex items-center gap-1 text-xs text-light-accent/70" title={owners.map(ownerName).join(', ')}>
                      <Users size={12} aria-hidden="true" className="shrink-0" />
                      <span className="truncate">Saved by {savedByText(owners, Number(job.saved_count) || owners.length)}</span>
                    </span>}
                  </button>
                  {job.status === 'completed' && lectureToolsReady && <div className="flex flex-wrap gap-2 mt-3">
                    <button type="button" onClick={() => openStudyTool(job, 'chat')} className={rowAction}><MessageSquare size={14} />Ask this lecture</button>
                    <button type="button" onClick={() => openStudyTool(job, 'quiz')} className={rowAction}><ListChecks size={14} />Generate questions</button>
                    <Link to={`/dashboard/oral-exam?transcript=${encodeURIComponent(job.job_id)}`} className={rowAction}><Mic size={14} />Oral exam</Link>
                  </div>}
                </article>
              </li>;
            })}
          </ul>
          {filteredJobs.length === 0 && (
            <div className="border border-dashed border-border rounded-xl p-6 text-center">
              {jobsLoaded ? <History className="w-6 h-6 text-light-accent/30 mx-auto" /> : <Loader2 className="w-6 h-6 text-light-accent/30 mx-auto animate-spin" />}
              <p className="text-sm text-light-accent/55 mt-2">{!jobsLoaded ? 'Loading your lectures…' : jobs.length ? 'No matching lectures' : 'No jobs yet'}</p>
            </div>
          )}
          {filteredJobs.length > 0 && <nav aria-label="Transcription pages" className="flex justify-between items-center gap-2 mt-3 text-sm">
            <button type="button" disabled={currentJobPage === 0} aria-label="Previous transcriptions" className="rounded-lg border border-border bg-white px-3 text-xs" onClick={() => setJobPage(currentJobPage - 1)}>Previous</button>
            <span className="tabular-nums">{currentJobPage + 1}/{jobPages}</span>
            <button type="button" disabled={currentJobPage === jobPages - 1} aria-label="Next transcriptions" className="rounded-lg border border-border bg-white px-3 text-xs" onClick={() => setJobPage(currentJobPage + 1)}>Next</button>
          </nav>}
        </aside>
      </section>

      {jobParam && (
        <motion.section ref={viewerRef} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass glow-border scroll-mt-6" aria-labelledby="lecture-viewer-heading">
          <div className="p-5 md:p-6 border-b border-border">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {!activeJob || isActive ? <Loader2 className="w-5 h-5 shrink-0 text-accent animate-spin" />
                    : activeJob.status === 'completed' ? <CheckCircle2 className="w-5 h-5 shrink-0 text-green-600" />
                      : <AlertCircle className="w-5 h-5 shrink-0 text-red-500" />}
                  <h2 id="lecture-viewer-heading" className="font-display text-xl font-semibold text-light-accent">{viewerHeading}</h2>
                </div>
                {activeJob && (jobTitle(activeJob) || jobUrl(activeJob)) && <p className="mt-2 text-left text-base font-medium text-light-accent break-words" dir="auto">
                  {jobTitle(activeJob) || jobUrl(activeJob)}
                </p>}
                {activeJob && jobTitle(activeJob) && jobUrl(activeJob) && <a href={jobUrl(activeJob)} target="_blank" rel="noreferrer"
                  className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-secondary hover:underline" dir="ltr">
                  <span className="truncate">{jobUrl(activeJob)}</span><ExternalLink size={12} aria-hidden="true" className="shrink-0" />
                </a>}
                {activeJob && <div className="mt-3 flex flex-wrap gap-2">
                  {(requested || detected) && <span className={chip}><Languages size={13} aria-hidden="true" />{languageText(requested, detected)}</span>}
                  <span className={chip}>{shownMode(activeJob) === 'fast' ? <Zap size={13} aria-hidden="true" /> : <Sparkles size={13} aria-hidden="true" />}{modeName(activeJob)}</span>
                  {jobTime(activeJob) > 0 && <span className={chip}><Clock3 size={13} aria-hidden="true" />Saved {formatWhen(jobTime(activeJob))}</span>}
                  {activeJob.cached && <span className={`${chip} bg-teal-50 text-teal-800`}>From the lecture library</span>}
                  {activeJob.shared && <span className={`${chip} bg-teal-50 text-teal-800`}>Shared transcription</span>}
                </div>}
                {isAdmin && savedBy.length > 0 && <p className="mt-3 flex items-start gap-2 text-sm text-light-accent/75">
                  <Users size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>Saved by {savedBy.map((owner) => `${ownerName(owner)}${owner.type === 'student' && owner.id != null ? ` (ID ${owner.id})` : ''}`).join(', ')}</span>
                </p>}
              </div>
              <button type="button" onClick={closeViewer} aria-label="Close lecture" title="Close lecture"
                className="inline-flex w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-light-accent/60 hover:text-accent">
                <X size={18} />
              </button>
            </div>

            {isActive && <div className="mt-5">
              <div className="flex items-center justify-between text-xs text-light-accent/60 mb-2">
                <span>{activeJob.total_steps ? `Step ${activeJob.current_step || 0} of ${activeJob.total_steps}` : 'Preparing'}</span>
                <span className="tabular-nums">{progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-surface-2 overflow-hidden" role="progressbar" aria-label="Lecture progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                <motion.div className="h-full bg-accent" initial={false} animate={{ width: `${progress}%` }} transition={{ duration: 0.4 }} />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <p className="text-light-accent/70">{activeJob.stage_label || 'Waiting for an update.'}</p>
                {activeJob.status === 'queued'
                  ? queueText(activeJob) && <p className="text-xs font-medium text-light-accent/70">{queueText(activeJob)}</p>
                  : activeJob.stage_started_at > 0 && activeJob.estimated_stage_seconds > 0 && <p className="text-xs text-light-accent/55">
                    Stage estimate: <StageCountdown startedAt={activeJob.stage_started_at} estimate={activeJob.estimated_stage_seconds} />
                  </p>}
              </div>
              <div className="mt-4 flex items-start gap-3 bg-secondary/10 border-l-2 border-secondary px-4 py-3">
                <Gauge className="w-4 h-4 text-secondary flex-shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed text-light-accent/70">
                  {WAITING_NOTES[activeJob.stage] || 'The lecture keeps processing on the server. You can leave this page — it reopens here when you come back.'}
                </p>
              </div>
            </div>}

            {connection.state === 'reconnecting' && <p role="status" className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <Loader2 size={15} className="mt-0.5 shrink-0 animate-spin" aria-hidden="true" />
              <span>Reconnecting to the transcription service…{isActive ? ' Your lecture keeps processing on the server.' : ''}{connection.message ? ` (${connection.message})` : ''}</span>
            </p>}
            {connection.state === 'error' && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{connection.message}</p>}
            {!activeJob && connection.state === 'ok' && <p role="status" className="mt-3 text-sm text-light-accent/60">Loading this lecture…</p>}

            {activeJob?.status === 'failed' && <div className="mt-4 flex flex-col gap-3 rounded-lg border-l-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
              <p>{activeJob.error || 'The server could not complete this lecture.'}</p>
              {jobUrl(activeJob) && <button type="button" onClick={() => resubmit(activeJob)} disabled={submitting}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 font-semibold text-red-700 hover:bg-red-100">
                <RotateCcw size={15} aria-hidden="true" />Submit again
              </button>}
            </div>}
          </div>

          {activeJob?.status === 'completed' && <div className="p-5 md:p-6 space-y-4">
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!lectureToolsReady} onClick={() => openStudyTool(activeJob, 'chat')} className={toolButton}><MessageSquare size={16} />Ask this lecture</button>
              <button type="button" disabled={!lectureToolsReady} onClick={() => openStudyTool(activeJob, 'quiz')} className={toolButton}><ListChecks size={16} />Generate questions</button>
              <Link to={`/dashboard/oral-exam?transcript=${encodeURIComponent(activeJob.job_id)}`} className={toolButton}><Mic size={16} />Oral exam on this lecture</Link>
            </div>
            {languageMismatch && <div role="note" className="flex flex-col gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
              <p>This transcript is in {languageName(detected)}, but {languageName(requested)} was requested.</p>
              <button type="button" onClick={() => resubmit(activeJob)} disabled={submitting}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-white px-3 font-semibold hover:bg-amber-100">
                <RotateCcw size={15} aria-hidden="true" />Transcribe again in {languageName(requested)}
              </button>
            </div>}
            {formattingFellBack(activeJob) && <div role="note" className="flex flex-col gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
              <p>AI formatting was unavailable for this lecture, so it is shown with automatic paragraphs.</p>
              <button type="button" onClick={() => resubmit(activeJob)} disabled={submitting}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-white px-3 font-semibold hover:bg-amber-100">
                <Sparkles size={15} aria-hidden="true" />Format again
              </button>
            </div>}
            {viewedTranscript.status === 'ready' ? <TranscriptView cleaned={viewedTranscript.cleaned} raw={viewedTranscript.raw}
              title={jobTitle(activeJob) || jobUrl(activeJob)} language={detected || requested} />
              : viewedTranscript.status === 'error' ? <div role="alert" className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="font-semibold">This transcript could not be loaded.</p><p className="mt-1">{viewedTranscript.error}</p></div>
                <button type="button" onClick={() => loadTranscripts(activeJob, { force: true })}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 font-semibold hover:bg-red-100">
                  <RefreshCw size={15} aria-hidden="true" />Try again
                </button>
              </div>
                : viewedTranscript.status === 'empty' ? <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-5 text-sm text-light-accent/70 sm:flex-row sm:items-center sm:justify-between">
                  <p>This transcript is empty. The lecture may have no speech the service could recognise.</p>
                  {jobUrl(activeJob) && <button type="button" onClick={() => resubmit(activeJob)} disabled={submitting} className={toolButton}><RotateCcw size={15} />Submit again</button>}
                </div>
                  : <p role="status" className="flex items-center gap-2 py-4 text-sm text-light-accent/60"><Loader2 size={16} className="animate-spin" aria-hidden="true" />Loading transcript…</p>}
          </div>}
        </motion.section>
      )}

      {isAdmin && <AdminLectureSaves onOpen={selectJob} />}
      {toolsJob && <LectureToolsPanel job={toolsJob.job} initialTab={toolsJob.tab} onClose={closeTools} />}
    </div>
  );
}
