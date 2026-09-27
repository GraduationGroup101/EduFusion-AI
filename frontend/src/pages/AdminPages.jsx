import PageHeader from '../components/ui/PageHeader';
import StatusBadge from '../components/ui/StatusBadge';
import EmptyState from '../components/ui/EmptyState';
import { lazy,Suspense,useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  Clock,
  ExternalLink,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
} from 'lucide-react';
import { adminService } from '../services/api';
const AcademicChatbot=lazy(()=>import('./ChatbotPage'));


export function AtRiskStudentsPage() {
  const [students, setStudents] = useState([]);
  const [query, setQuery] = useState('');
  const [course, setCourse] = useState('');
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState('');
  const requestVersion = useRef(0);
  const pageSize = 15;
  const filteredStudents = students.filter(row => String(row.id_student).includes(query.trim()) && (!course || row.code_module === course));
  const pageCount = Math.max(1, Math.ceil(filteredStudents.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleStudents = filteredStudents.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const [riskLevel, setRiskLevel] = useState('HIGH');
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const loadStudents = async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadError('');
    try {
      const { data } = await adminService.getAtRiskStudents({ risk_level: riskLevel, limit: 100 });
      if (version !== requestVersion.current) return;
      setStudents(data.students || []);
      setPage(1);
    } catch (err) {
      if (version !== requestVersion.current) return;
      setLoadError('We could not refresh these results. Try again; previously loaded results may be out of date.');
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  };

  const runBatch = async () => {
    setRunning(true);
    try {
      const { data } = await adminService.runDemoPredictions(150);
      toast.success(`Updated ${data.total_students} predictions`);
      await loadStudents();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to run predictions');
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    loadStudents();
  }, [riskLevel]);

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="At-Risk Students" icon={AlertTriangle} description="Identify students who may benefit from a little more support.">
        <button onClick={runBatch} disabled={running} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary text-white text-sm font-medium disabled:opacity-60">
          {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Run Demo Batch
        </button>
      </PageHeader>
      <div className="data-toolbar">
        <label className="field-label">Search student ID<input value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="Enter a student ID" type="search" /></label>
        <label className="field-label">Risk level<select value={riskLevel} onChange={e => { setRiskLevel(e.target.value); setPage(1); setCourse(''); }}><option value="HIGH">High risk</option><option value="MEDIUM">Medium risk</option><option value="LOW">Low risk</option></select></label>
        <label className="field-label">Course<select value={course} onChange={e => { setCourse(e.target.value); setPage(1); }}><option value="">All loaded courses</option>{[...new Set(students.map(row => row.code_module))].sort().map(code => <option key={code}>{code}</option>)}</select></label>
        <button onClick={loadStudents} disabled={loading} className="px-4 py-2 border border-border text-sm">{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      {loadError && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{loadError}</p>}

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-5 glow-border">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-5 h-5 text-accent" />
          <h2 className="font-display font-semibold text-light-accent">Latest Results</h2>
        </div>
        {loading ? (
          <div role="status" className="h-32 flex items-center justify-center text-light-accent/40">Loading results…</div>
        ) : filteredStudents.length === 0 ? (
          <EmptyState icon={Search} title="No matching students" description="Try another student ID, course or risk level." />
        ) : (
          <div className="table-scroll" role="region" aria-label="Student risk results" tabIndex={0}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border">
                  {['Student ID', 'Course', 'Day', 'Risk', 'Probability', 'Action', 'Updated'].map((h) => (
                    <th key={h} className="pb-3 pr-4 text-xs font-mono text-light-accent/50 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {visibleStudents.map((row) => (
                  <tr key={`${row.enrollment_id}-${row.day_of_course}`} className="hover:bg-secondary/5">
                    <td className="py-3 pr-4 font-medium text-light-accent">{row.id_student}</td>
                    <td className="py-3 pr-4 text-light-accent/70">{row.code_module} / {row.code_presentation}</td>
                    <td className="py-3 pr-4 font-mono text-light-accent/70">{row.day_of_course}</td>
                    <td className="py-3 pr-4"><StatusBadge status={row.risk_level} /></td>
                    <td className="py-3 pr-4 font-mono text-light-accent/80">{(row.risk_probability * 100).toFixed(1)}%</td>
                    <td className="py-3 pr-4 text-light-accent/55 text-xs table-action">{row.recommended_action || '-'}</td>
                    <td className="py-3 pr-4 text-light-accent/40 font-mono text-xs">{new Date(row.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && <div className="table-pagination">
          <p role="status">{filteredStudents.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, filteredStudents.length)} of {filteredStudents.length} matching results · Up to 100 loaded</p>
          <div className="flex items-center gap-3"><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage} of {pageCount}</span><button disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div>
        </div>}
      </motion.div>
    </div>
  );
}

const CURRENT_CHATBOT_ADMIN_URL = `${
  (import.meta.env.VITE_CHATBOT_APP_URL || 'https://final-iug-chat-botv2.onrender.com').replace(/\/$/, '')
}/app/admin.html`;

export function ChatbotFilesPage() {
  return <>
    <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
      <p className="text-sm text-muted">Academic chatbot administration</p>
      <a href={CURRENT_CHATBOT_ADMIN_URL} target="_blank" rel="noreferrer" className="btn-secondary inline-flex items-center gap-2">
        Manage knowledge base <ExternalLink size={16}/>
      </a>
    </div>
    <Suspense fallback={<p role="status">Loading academic chatbot…</p>}><AcademicChatbot/></Suspense>
  </>;
}

export function AcademicClockPage() {
  const [clocks, setClocks] = useState([]);
  const [clockError, setClockError] = useState('');
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [globalDay, setGlobalDay] = useState(60);

  const loadClocks = async () => {
    setLoading(true);
    setClockError('');
    try {
      const { data } = await adminService.getClocks();
      setClocks(data.clocks || []);
    } catch (err) {
      setClockError('Academic clocks could not be refreshed. Try again; any displayed days may be out of date.');
    } finally {
      setLoading(false);
    }
  };

  const recomputePredictions = async () => {
    const { data } = await adminService.runDemoPredictions(150);
    return data;
  };

  const tickAll = async (days) => {
    setRunning(true);
    try {
      const { data } = await adminService.tickAllClocks(days);
      (data.warnings || []).forEach((message) => toast(message));
      toast.success(`Updated ${data.updatedClocks} clocks and recomputed ${data.predictions?.total_students || 0} predictions`);
      await loadClocks();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update clocks and predictions');
    } finally {
      setRunning(false);
    }
  };

  const resetAll = async (day) => {
    setRunning(true);
    try {
      const { data } = await adminService.resetAllClocks(day);
      (data.warnings || []).forEach((message) => toast(message));
      toast.success(`Reset ${data.updatedClocks} clocks to day ${day} and recomputed ${data.predictions?.total_students || 0} predictions`);
      await loadClocks();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reset clocks and predictions');
    } finally {
      setRunning(false);
    }
  };

  const runPredictions = async () => {
    setRunning(true);
    try {
      const data = await recomputePredictions();
      toast.success(`Recomputed ${data.total_students} predictions`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to run predictions');
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    loadClocks();
  }, []);

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Academic Clock" icon={Clock} description="Set the simulated academic day and keep risk predictions in step.">
        <button onClick={loadClocks} disabled={loading} className="px-4 py-2 border border-border text-sm">{loading ? 'Refreshing…' : 'Refresh'}</button>
      </PageHeader>
      {clockError && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{clockError}</p>}
      <section className="glass p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><p className="text-sm text-muted">Current simulated day</p><p className="text-3xl font-semibold mt-1">{loading ? '…' : !clocks.length ? 'Not available' : new Set(clocks.map(clock => clock.current_day)).size === 1 ? clocks[0].current_day : 'Varies by course'}</p></div>
          <StatusBadge status="neutral">Applies to all course clocks</StatusBadge>
        </div>
        <p className="text-sm text-muted">Changing the day automatically recomputes demo predictions. Course-specific progress is shown below.</p>
        <div className="data-toolbar">
          <label className="field-label">Set academic day<input type="number" min="0" value={globalDay} onChange={e => setGlobalDay(e.target.value)} className="w-36" /></label>
          <button disabled={running} onClick={() => resetAll(Number(globalDay))} className="flex items-center gap-2 px-4 py-2 bg-secondary text-white text-sm font-medium"><RotateCcw size={16}/>{running ? 'Updating…' : 'Set all clocks'}</button>
          <button disabled={running} onClick={() => tickAll(1)} className="px-4 py-2 border border-border text-sm">Advance 1 day</button>
          <button disabled={running} onClick={() => tickAll(10)} className="px-4 py-2 border border-border text-sm">Advance 10 days</button>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-border"><button onClick={runPredictions} disabled={running} className="px-4 py-2 border border-border text-sm">Update Predictions</button><p className="text-xs text-muted">Refresh predictions without changing the day.</p></div>
      </section>

      <div className="glass rounded-2xl p-5 glow-border">
        <h2 className="font-display font-semibold text-light-accent mb-4">Clock Snapshot</h2>
        {loading ? (
          <div role="status" className="h-24 flex items-center justify-center text-light-accent/40">Loading clocks…</div>
        ) : clocks.length === 0 ? (
          <EmptyState icon={Clock} title="No course clocks available" description="Refresh to check for course clocks before changing the academic day." />
        ) : (
          <div className="table-scroll" role="region" aria-label="Course clock snapshot" tabIndex={0}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border">
                  {['Course', 'Current Day', 'Max Day', 'Progress'].map((h) => (
                    <th key={h} className="pb-3 pr-4 text-xs font-mono text-light-accent/50 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {clocks.map((clock) => {
                  const pct = clock.max_day > 0 ? Math.min(100, Math.max(0, Math.round((clock.current_day / clock.max_day) * 100))) : 0;
                  return (
                    <tr key={clock.id}>
                      <td className="py-3 pr-4 text-light-accent font-medium">{clock.code_module} / {clock.code_presentation}</td>
                      <td className="py-3 pr-4 text-light-accent/75 font-mono">{clock.current_day}</td>
                      <td className="py-3 pr-4 text-light-accent/55 font-mono">{clock.max_day}</td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-32 rounded-full bg-surface-2 overflow-hidden">
                            <div className="h-full bg-secondary" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-light-accent/50 font-mono">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
