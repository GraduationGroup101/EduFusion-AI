import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, RefreshCw, Search, Users } from 'lucide-react';
import { lectureScribeService } from '../../services/api';

const PAGE_SIZE = 15;
const LANGUAGES = { auto: 'Auto-detect', ar: 'Arabic', en: 'English' };
export const languageName = (code) => LANGUAGES[code] || (code ? String(code).toUpperCase() : '');

/** "Arabic", "Auto · Arabic" or "Arabic · detected English" from the requested and detected codes. */
export const languageText = (requested, detected) => {
  if (!requested) return detected ? languageName(detected) : '';
  if (requested === 'auto') return detected ? `Auto · ${languageName(detected)}` : languageName('auto');
  if (detected && detected !== requested) return `${languageName(requested)} · detected ${languageName(detected)}`;
  return languageName(requested);
};

// Accepts epoch seconds, epoch milliseconds or an ISO string.
export const formatWhen = (value) => {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  const date = Number.isFinite(number) ? new Date(number > 1e12 ? number : number * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const STATUS = { completed: ['success', 'Completed'], failed: ['danger', 'Failed'], queued: ['warning', 'Queued'], running: ['warning', 'Running'] };
export function StatusPill({ status, lost = false }) {
  const [tone, label] = lost ? ['danger', 'Interrupted'] : STATUS[status] || ['neutral', status || 'Unknown'];
  return <span className={`status-badge status-${tone} shrink-0 capitalize`}><span className="status-dot" aria-hidden="true" />{label}</span>;
}

export const ownerName = (owner) => owner?.name || (owner?.type === 'student' ? `Student ${owner.id}` : owner?.id ? `User ${owner.id}` : 'Unknown account');
const ownerDetail = (owner) => {
  if (!owner) return '';
  if (owner.type === 'student') return `Student ID ${owner.id}`;
  return [owner.role ? owner.role[0].toUpperCase() + owner.role.slice(1) : 'Staff', owner.email].filter(Boolean).join(' · ');
};

const errorText = (error) => {
  const status = error?.response?.status;
  if (status === 403) return 'Only administrators can see every student’s saved lectures.';
  if (status === 404) return 'This server does not provide the saved-lectures report yet.';
  const data = error?.response?.data;
  return (typeof data?.error === 'string' && data.error) || 'Saved lectures could not be loaded. Try again.';
};
const pager = 'inline-flex items-center gap-1 rounded-lg border border-border bg-white px-3 text-sm disabled:opacity-40';

/** Admin report: every lecture each student saved, newest first, with who saved it. */
export default function AdminLectureSaves({ onOpen }) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState({ saves: [], total: 0 });
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => { setSearch(query.trim()); setPage(0); }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    (async () => {
      try {
        const { data } = await lectureScribeService.adminSaves({ q: search, limit: PAGE_SIZE, offset: page * PAGE_SIZE }, { signal: controller.signal });
        if (controller.signal.aborted) return;
        const saves = Array.isArray(data?.saves) ? data.saves : [];
        setResult({ saves, total: Number.isFinite(Number(data?.total)) ? Number(data.total) : saves.length });
        setState('ready'); setError('');
      } catch (requestError) {
        if (controller.signal.aborted || requestError?.code === 'ERR_CANCELED') return;
        setState('error'); setError(errorText(requestError));
      }
    })();
    return () => controller.abort();
  }, [search, page, reload]);

  const { saves, total } = result;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total ? page * PAGE_SIZE + 1 : 0;
  const last = Math.min(total, page * PAGE_SIZE + saves.length);

  return <section aria-labelledby="admin-lecture-saves" className="glass glow-border p-5 md:p-6 space-y-4">
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-mono uppercase text-light-accent/45">Every student save</p>
        <h2 id="admin-lecture-saves" className="mt-1 flex items-center gap-2 font-display text-lg font-semibold text-light-accent">
          <Users size={18} className="text-secondary" aria-hidden="true" />Saved lectures by student
        </h2>
        <p className="mt-1 text-sm text-light-accent/60">Who saved which lecture, in which language, and when.</p>
      </div>
      <button type="button" onClick={() => setReload((value) => value + 1)} disabled={state === 'loading'} aria-label="Refresh saved lectures by student"
        className="inline-flex w-10 items-center justify-center rounded-lg border border-border bg-white text-light-accent/60 hover:text-accent disabled:opacity-50">
        <RefreshCw size={16} className={state === 'loading' ? 'animate-spin' : ''} />
      </button>
    </header>

    <label className="relative block">
      <span className="sr-only">Search saved lectures by student</span>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-light-accent/40" aria-hidden="true" />
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by student name or ID, lecture title or URL"
        className="h-11 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm outline-none focus:border-secondary" />
    </label>

    {state === 'error' && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
      <span>{error}</span>
      <button type="button" className={pager} onClick={() => setReload((value) => value + 1)}>Try again</button>
    </div>}

    {state !== 'error' && <>
      <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,0.9fr)_auto_minmax(0,0.9fr)_auto] gap-4 border-b border-border px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-light-accent/50 lg:grid" aria-hidden="true">
        <span>Student</span><span>Lecture</span><span>Language</span><span>Status</span><span>Saved</span><span className="w-[72px]" />
      </div>
      <ul className="space-y-2 lg:space-y-0 lg:divide-y lg:divide-border" aria-label="Saved lectures by student" aria-busy={state === 'loading'}>
        {saves.map((save) => {
          const lecture = save.title || save.youtube_url || save.job_id;
          return <li key={`${save.owner?.owner_key || ownerName(save.owner)}:${save.job_id}`}
            className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-white p-3 text-sm lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,0.9fr)_auto_minmax(0,0.9fr)_auto] lg:items-center lg:gap-4 lg:rounded-none lg:border-0 lg:bg-transparent">
            <div className="min-w-0">
              <p className="truncate text-left font-semibold text-light-accent" dir="auto">{ownerName(save.owner)}</p>
              <p className="truncate text-xs text-light-accent/55">{ownerDetail(save.owner)}</p>
            </div>
            <div className="min-w-0">
              <p className="truncate text-left text-light-accent" dir="auto" title={lecture}>{lecture}</p>
              {save.title && save.youtube_url && <a href={save.youtube_url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 truncate text-xs text-secondary hover:underline">
                <span className="truncate">{save.youtube_url}</span><ExternalLink size={11} aria-hidden="true" /></a>}
            </div>
            <p className="text-xs text-light-accent/70"><span className="lg:hidden font-semibold">Language: </span>{languageText(save.language, save.detected_language) || '—'}{save.mode ? ` · ${save.mode === 'fast' ? 'Fast' : 'Formatted'}` : ''}</p>
            <div className="flex items-center gap-2"><StatusPill status={save.status} lost={save.lost} />
              {save.has_transcript === false && save.status === 'completed' && <span className="text-xs text-amber-700">No stored copy</span>}</div>
            <p className="text-xs text-light-accent/60"><span className="lg:hidden font-semibold">Saved: </span>{formatWhen(save.saved_at) || '—'}</p>
            <button type="button" onClick={() => onOpen?.(save.job_id)} aria-label={`Open ${lecture} saved by ${ownerName(save.owner)}`}
              className="inline-flex w-full items-center justify-center rounded-lg border border-border bg-white px-3 text-sm font-medium hover:border-secondary hover:text-secondary lg:w-[72px]">Open</button>
          </li>;
        })}
      </ul>
      {state === 'loading' && !saves.length && <p role="status" className="flex items-center gap-2 text-sm text-light-accent/60"><Loader2 size={15} className="animate-spin" />Loading saved lectures…</p>}
      {state === 'ready' && !saves.length && <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-light-accent/60">
        {search ? `No saved lectures match “${search}”.` : 'No student has saved a lecture yet.'}</p>}
      {total > 0 && <nav aria-label="Saved lecture pages" className="flex flex-wrap items-center justify-between gap-3 text-sm text-light-accent/70">
        <span>Showing {first}–{last} of {total.toLocaleString('en-US')}</span>
        <span className="flex items-center gap-2">
          <button type="button" className={pager} disabled={page === 0 || state === 'loading'} onClick={() => setPage(page - 1)} aria-label="Previous saved lectures"><ChevronLeft size={16} />Previous</button>
          <span className="tabular-nums">{page + 1}/{pages}</span>
          <button type="button" className={pager} disabled={page >= pages - 1 || state === 'loading'} onClick={() => setPage(page + 1)} aria-label="Next saved lectures">Next<ChevronRight size={16} /></button>
        </span>
      </nav>}
    </>}
  </section>;
}
