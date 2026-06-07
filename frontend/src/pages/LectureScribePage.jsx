import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  FileText,
  Gauge,
  History,
  Loader2,
  RefreshCw,
  Sparkles,
  WifiOff,
  Youtube,
  Zap,
} from 'lucide-react';
import { lectureScribeService } from '../services/api';

const WAITING_NOTES = {
  queued: 'Your lecture is in the queue and will start shortly.',
  checking_cache: 'Checking saved results first can skip the full transcription pipeline.',
  downloading: 'The audio is being prepared. Keep this page open while the job continues.',
  transcribing: 'Whisper is listening to the lecture and preserving its original spoken language.',
  formatting: 'The cleaner is improving structure and readability without changing the lecture content.',
  saving: 'The result is being saved so the same lecture can be returned faster next time.',
};

const formatDate = (value) => {
  if (!value) return 'Not started';
  return new Date(value * 1000).toLocaleString();
};

const formatSeconds = (value) => {
  const seconds = Math.max(0, Math.round(value || 0));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const modeName = (job) => (job?.request?.clean === false ? 'Fast output' : 'Better formatting');

const errorMessage = (error, fallback) => {
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  return error.response?.data?.error || error.message || fallback;
};

const isServiceUnavailable = (error) => [503, 504].includes(error.response?.status);

export default function LectureScribePage() {
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [mode, setMode] = useState('formatted');
  const [serviceStatus, setServiceStatus] = useState('checking');
  const [submitting, setSubmitting] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [transcript, setTranscript] = useState('');
  const [transcriptKind, setTranscriptKind] = useState('cleaned');
  const [jobs, setJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [clockTick, setClockTick] = useState(Date.now());

  const checkService = useCallback(async () => {
    setServiceStatus('checking');
    try {
      await lectureScribeService.health();
      setServiceStatus('online');
      return true;
    } catch {
      setServiceStatus('offline');
      return false;
    }
  }, []);

  const loadJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const { data } = await lectureScribeService.listJobs();
      const sorted = [...(data.jobs || [])].sort(
        (a, b) => (b.submitted_at || 0) - (a.submitted_at || 0)
      );
      setJobs(sorted);
    } catch (error) {
      if (isServiceUnavailable(error)) {
        setServiceStatus('offline');
        return;
      }
      toast.error(errorMessage(error, 'Unable to load previous jobs'));
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  const loadTranscript = useCallback(async (job) => {
    const preferredKind = job.result?.cleaned_transcript_path ? 'cleaned' : 'raw';

    try {
      const { data } = await lectureScribeService.getTranscript(job.job_id, preferredKind);
      setTranscript(String(data || ''));
      setTranscriptKind(preferredKind);
    } catch (error) {
      if (isServiceUnavailable(error)) {
        setServiceStatus('offline');
        return;
      }
      if (preferredKind === 'cleaned') {
        try {
          const { data } = await lectureScribeService.getTranscript(job.job_id, 'raw');
          setTranscript(String(data || ''));
          setTranscriptKind('raw');
          return;
        } catch {
          // Report the original cleaned-transcript failure below.
        }
      }
      toast.error(errorMessage(error, 'Unable to load transcript'));
    }
  }, []);

  const openJob = useCallback(async (jobId) => {
    try {
      const { data } = await lectureScribeService.getJob(jobId);
      setActiveJob(data);
      setTranscript('');
      if (data.status === 'completed') await loadTranscript(data);
    } catch (error) {
      if (isServiceUnavailable(error)) {
        setServiceStatus('offline');
        return;
      }
      toast.error(errorMessage(error, 'Unable to open this job'));
    }
  }, [loadTranscript]);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      const online = await checkService();
      if (!cancelled && online) loadJobs();
    };

    initialize();
    return () => {
      cancelled = true;
    };
  }, [checkService, loadJobs]);

  useEffect(() => {
    if (!activeJob || !['queued', 'running'].includes(activeJob.status)) return undefined;

    let cancelled = false;
    const poll = async () => {
      try {
        const { data } = await lectureScribeService.getJob(activeJob.job_id);
        if (cancelled) return;
        setActiveJob(data);
        if (data.status === 'completed') {
          await loadTranscript(data);
          loadJobs();
          toast.success('Transcript is ready');
        } else if (data.status === 'failed') {
          loadJobs();
          toast.error(data.error || 'Transcription failed');
        }
      } catch (error) {
        if (!cancelled && isServiceUnavailable(error)) {
          setServiceStatus('offline');
        } else if (!cancelled) {
          toast.error(errorMessage(error, 'Unable to refresh job status'));
        }
      }
    };

    const pollTimer = setInterval(poll, 2500);
    const clockTimer = setInterval(() => setClockTick(Date.now()), 1000);
    poll();

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      clearInterval(clockTimer);
    };
  }, [activeJob?.job_id, activeJob?.status, loadJobs, loadTranscript]);

  const remainingSeconds = useMemo(() => {
    if (!activeJob?.stage_started_at || !activeJob?.estimated_stage_seconds) return 0;
    const elapsed = clockTick / 1000 - activeJob.stage_started_at;
    return Math.max(0, activeJob.estimated_stage_seconds - elapsed);
  }, [activeJob?.estimated_stage_seconds, activeJob?.stage_started_at, clockTick]);

  const submitJob = async (event) => {
    event.preventDefault();
    const url = youtubeUrl.trim();
    if (!url) {
      toast.error('Enter a YouTube lecture URL');
      return;
    }

    setSubmitting(true);
    setTranscript('');
    try {
      const { data } = await lectureScribeService.createJob({
        youtube_url: url,
        clean: mode === 'formatted',
      });
      setActiveJob({
        ...data,
        status: 'queued',
        stage: 'queued',
        stage_label: 'Waiting to start.',
        progress_percent: 2,
        current_step: 0,
        total_steps: mode === 'formatted' ? 5 : 4,
        request: { youtube_url: url, clean: mode === 'formatted' },
      });
      toast.success('Lecture submitted');
      loadJobs();
    } catch (error) {
      if (isServiceUnavailable(error)) {
        setServiceStatus('offline');
        return;
      }
      toast.error(errorMessage(error, 'Unable to submit lecture'));
    } finally {
      setSubmitting(false);
    }
  };

  const copyTranscript = async () => {
    if (!transcript) return;
    await navigator.clipboard.writeText(transcript);
    toast.success('Transcript copied');
  };

  const isActive = activeJob && ['queued', 'running'].includes(activeJob.status);
  const progress = Math.max(0, Math.min(100, activeJob?.progress_percent || 0));

  if (serviceStatus === 'checking') {
    return (
      <div className="min-h-full p-4 md:p-8 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-7 h-7 mx-auto text-accent animate-spin" />
          <p className="mt-4 text-sm font-medium text-light-accent">Connecting to LectureScribe</p>
          <p className="mt-1 text-xs text-light-accent/45">Checking transcription service availability...</p>
        </div>
      </div>
    );
  }

  if (serviceStatus === 'offline') {
    return (
      <div className="min-h-full p-4 md:p-8 flex items-center justify-center">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-2xl text-center py-12 md:py-16"
        >
          <div className="w-16 h-16 mx-auto bg-red-50 border border-red-200 text-red-500 flex items-center justify-center">
            <WifiOff className="w-7 h-7" />
          </div>
          <p className="mt-6 text-xs font-mono uppercase text-accent">Temporarily unavailable</p>
          <h1 className="mt-3 font-display text-3xl md:text-4xl font-bold text-light-accent">
            LectureScribe is taking a short break
          </h1>
          <p className="mt-4 mx-auto max-w-lg text-sm md:text-base leading-7 text-light-accent/55">
            The transcription service is currently offline. Your account and previous work are safe.
            Please try again in a few minutes.
          </p>
          <button
            type="button"
            onClick={async () => {
              const online = await checkService();
              if (online) {
                await loadJobs();
                toast.success('LectureScribe is back online');
              }
            }}
            className="mt-7 h-11 px-5 bg-accent text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
        </motion.section>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-2 text-accent text-xs font-mono uppercase">
            <Youtube className="w-4 h-4" />
            Lecture intelligence
          </div>
          <h1 className="font-display text-3xl font-bold text-light-accent mt-2">LectureScribe</h1>
          <p className="text-light-accent/55 text-sm mt-1 max-w-2xl">
            Turn a YouTube lecture into a searchable transcript, then optionally format it for easier reading.
          </p>
        </motion.div>

        <div className={`inline-flex self-start items-center gap-2 border px-3 py-2 text-xs font-mono ${
          serviceStatus === 'online'
            ? 'border-green-500/25 bg-green-500/10 text-green-700'
            : serviceStatus === 'offline'
              ? 'border-red-500/25 bg-red-500/10 text-red-600'
              : 'border-border bg-white text-light-accent/55'
        }`}>
          {serviceStatus === 'checking' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : serviceStatus === 'online' ? (
            <CheckCircle2 className="w-3.5 h-3.5" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5" />
          )}
          {serviceStatus === 'checking' ? 'Checking service' : serviceStatus === 'online' ? 'Service online' : 'Service offline'}
        </div>
      </header>

      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5">
        <form onSubmit={submitJob} className="glass glow-border p-5 md:p-6 space-y-6">
          <div>
            <label htmlFor="lecture-url" className="block text-sm font-semibold text-light-accent mb-2">
              YouTube lecture URL
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Youtube className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-red-500" />
                <input
                  id="lecture-url"
                  type="url"
                  value={youtubeUrl}
                  onChange={(event) => setYoutubeUrl(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="w-full h-12 border border-border bg-white pl-12 pr-4 text-sm text-light-accent outline-none transition-colors focus:border-accent"
                />
              </div>
              <button
              type="submit"
                disabled={submitting || serviceStatus !== 'online' || isActive}
                className="h-12 px-6 bg-accent text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {submitting ? 'Submitting' : 'Create transcript'}
              </button>
            </div>
          </div>

          <fieldset>
            <legend className="text-sm font-semibold text-light-accent mb-3">Processing mode</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 border border-border">
              <label className={`cursor-pointer p-4 transition-colors border-b md:border-b-0 md:border-r border-border ${
                mode === 'fast' ? 'bg-secondary/15' : 'bg-white hover:bg-secondary/5'
              }`}>
                <input
                  type="radio"
                  name="mode"
                  value="fast"
                  checked={mode === 'fast'}
                  onChange={() => setMode('fast')}
                  className="sr-only"
                />
                <span className="flex items-start gap-3">
                  <span className="w-9 h-9 bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
                    <Zap className="w-4 h-4" />
                  </span>
                  <span>
                    <span className="flex items-center gap-2 text-sm font-semibold text-light-accent">
                      Fast output
                      {mode === 'fast' && <Check className="w-4 h-4 text-accent" />}
                    </span>
                    <span className="block text-xs leading-relaxed text-light-accent/50 mt-1">
                      Whisper plus cloud cleanup when available. Returns raw text if cleanup is unavailable.
                    </span>
                  </span>
                </span>
              </label>

              <label className={`cursor-pointer p-4 transition-colors ${
                mode === 'formatted' ? 'bg-secondary/15' : 'bg-white hover:bg-secondary/5'
              }`}>
                <input
                  type="radio"
                  name="mode"
                  value="formatted"
                  checked={mode === 'formatted'}
                  onChange={() => setMode('formatted')}
                  className="sr-only"
                />
                <span className="flex items-start gap-3">
                  <span className="w-9 h-9 bg-teal-100 text-teal-700 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-4 h-4" />
                  </span>
                  <span>
                    <span className="flex items-center gap-2 text-sm font-semibold text-light-accent">
                      Better formatting
                      {mode === 'formatted' && <Check className="w-4 h-4 text-accent" />}
                    </span>
                    <span className="block text-xs leading-relaxed text-light-accent/50 mt-1">
                      Uses cloud cleanup first and local Ollama as fallback for a more reliable formatted result.
                    </span>
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
        </form>

        <aside className="glass glow-border p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-xs font-mono uppercase text-light-accent/45">Recent activity</p>
              <h2 className="font-display text-lg font-semibold text-light-accent mt-1">Previous jobs</h2>
            </div>
            <button
              type="button"
              onClick={loadJobs}
              disabled={loadingJobs}
              className="w-10 h-10 border border-border bg-white text-light-accent/60 hover:text-accent disabled:opacity-50 inline-flex items-center justify-center"
              aria-label="Refresh previous jobs"
              title="Refresh previous jobs"
            >
              <RefreshCw className={`w-4 h-4 ${loadingJobs ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="space-y-2 max-h-[330px] overflow-y-auto pr-1">
            {jobs.slice(0, 8).map((job) => (
              <button
                key={job.job_id}
                type="button"
                onClick={() => openJob(job.job_id)}
                className="w-full border border-border bg-white p-3 text-left hover:border-secondary transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm font-medium text-light-accent truncate">
                    {job.request?.youtube_url || job.job_id}
                  </span>
                  <span className={`text-[10px] font-mono uppercase ${
                    job.status === 'completed'
                      ? 'text-green-700'
                      : job.status === 'failed'
                        ? 'text-red-600'
                        : 'text-amber-700'
                  }`}>
                    {job.status}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-light-accent/45 mt-2">
                  <span>{modeName(job)}</span>
                  <span>{formatDate(job.submitted_at)}</span>
                </div>
              </button>
            ))}

            {!loadingJobs && jobs.length === 0 && (
              <div className="border border-dashed border-border p-6 text-center">
                <History className="w-6 h-6 text-light-accent/30 mx-auto" />
                <p className="text-sm text-light-accent/45 mt-2">No jobs yet</p>
              </div>
            )}
          </div>
        </aside>
      </section>

      {activeJob && (
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass glow-border">
          <div className="p-5 md:p-6 border-b border-border">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  {isActive ? (
                    <Loader2 className="w-5 h-5 text-accent animate-spin" />
                  ) : activeJob.status === 'completed' ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-red-500" />
                  )}
                  <h2 className="font-display text-xl font-semibold text-light-accent">
                    {activeJob.status === 'completed' ? 'Transcript ready' : activeJob.status === 'failed' ? 'Job failed' : 'Processing lecture'}
                  </h2>
                </div>
                <p className="text-sm text-light-accent/55 mt-2">
                  {activeJob.stage_label || activeJob.error || 'Waiting for an update.'}
                </p>
              </div>

              <div className="flex items-center gap-5 text-sm">
                <div>
                  <p className="text-[10px] font-mono uppercase text-light-accent/40">Mode</p>
                  <p className="font-medium text-light-accent mt-1">{modeName(activeJob)}</p>
                </div>
                {isActive && (
                  <div>
                    <p className="text-[10px] font-mono uppercase text-light-accent/40">Stage estimate</p>
                    <p className="font-medium text-light-accent mt-1">{formatSeconds(remainingSeconds)}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between text-xs text-light-accent/50 mb-2">
                <span>Step {activeJob.current_step || 0} of {activeJob.total_steps || 0}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 bg-surface-2 overflow-hidden">
                <motion.div
                  className={`h-full ${activeJob.status === 'failed' ? 'bg-red-500' : 'bg-accent'}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>
            </div>

            {isActive && (
              <div className="mt-4 flex items-start gap-3 bg-secondary/10 border-l-2 border-secondary px-4 py-3">
                <Gauge className="w-4 h-4 text-secondary flex-shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed text-light-accent/60">
                  {WAITING_NOTES[activeJob.stage] || 'The job continues on the server. You can leave this page and open it again from Previous jobs.'}
                </p>
              </div>
            )}

            {activeJob.status === 'failed' && (
              <div className="mt-4 bg-red-50 border-l-2 border-red-500 px-4 py-3 text-sm text-red-700">
                {activeJob.error || 'The server could not complete this job.'}
              </div>
            )}
          </div>

          {transcript && (
            <div className="p-5 md:p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-accent" />
                    <h3 className="font-display text-lg font-semibold text-light-accent">Transcript</h3>
                  </div>
                  <p className="text-xs text-light-accent/45 mt-1">
                    {transcriptKind === 'cleaned' ? 'Formatted output' : 'Original Whisper output'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={copyTranscript}
                  className="h-10 px-4 border border-border bg-white text-sm text-light-accent/70 hover:text-accent inline-flex items-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  Copy
                </button>
              </div>
              <pre
                dir="auto"
                className="max-h-[620px] overflow-auto border border-border bg-white p-4 md:p-5 whitespace-pre-wrap font-sans text-sm leading-7 text-light-accent"
              >
                {transcript}
              </pre>
            </div>
          )}

          {!transcript && activeJob.status === 'completed' && (
            <div className="p-6 flex items-center gap-3 text-sm text-light-accent/55">
              <Clock3 className="w-4 h-4" />
              Loading transcript content...
            </div>
          )}
        </motion.section>
      )}
    </div>
  );
}
