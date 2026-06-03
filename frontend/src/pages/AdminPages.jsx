import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { AlertTriangle, Clock, Play, RotateCcw, Search, RefreshCw } from 'lucide-react';
import { adminService } from '../services/api';

const RiskBadge = ({ level }) => {
  const cls = level === 'HIGH'
    ? 'bg-red-500/15 text-red-600 border-red-500/20'
    : level === 'MEDIUM'
      ? 'bg-amber-500/15 text-amber-700 border-amber-500/20'
      : 'bg-green-500/15 text-green-700 border-green-500/20';

  return <span className={`px-2 py-1 rounded-md border text-xs font-medium ${cls}`}>{level}</span>;
};

export function AtRiskStudentsPage() {
  const [students, setStudents] = useState([]);
  const [riskLevel, setRiskLevel] = useState('HIGH');
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const loadStudents = async () => {
    setLoading(true);
    try {
      const { data } = await adminService.getAtRiskStudents({ risk_level: riskLevel, limit: 100 });
      setStudents(data.students || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load at-risk students');
    } finally {
      setLoading(false);
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
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-gradient">At-Risk Students</h1>
          <p className="text-light-accent/55 text-sm mt-1">Monitor students ordered by latest model risk score.</p>
        </div>
        <button
          onClick={runBatch}
          disabled={running}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium disabled:opacity-60"
        >
          {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Run Demo Batch
        </button>
      </motion.div>

      <div className="glass rounded-2xl p-4 glow-border flex items-center gap-3">
        <Search className="w-4 h-4 text-accent" />
        <select
          value={riskLevel}
          onChange={(e) => setRiskLevel(e.target.value)}
          className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-light-accent focus:outline-none focus:border-accent"
        >
          <option value="HIGH">High Risk</option>
          <option value="MEDIUM">Medium Risk</option>
          <option value="LOW">Low Risk</option>
        </select>
        <button onClick={loadStudents} className="px-3 py-2 rounded-lg border border-border text-sm text-light-accent hover:bg-secondary/10">
          Refresh
        </button>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-5 glow-border">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-5 h-5 text-accent" />
          <h2 className="font-display font-semibold text-light-accent">Latest Results</h2>
        </div>
        {loading ? (
          <div className="h-32 flex items-center justify-center text-light-accent/40">Loading...</div>
        ) : students.length === 0 ? (
          <div className="h-32 flex items-center justify-center text-light-accent/40">No students found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border">
                  {['Student ID', 'Course', 'Day', 'Risk', 'Probability', 'Action', 'Updated'].map((h) => (
                    <th key={h} className="pb-3 pr-4 text-xs font-mono text-light-accent/50 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {students.map((row) => (
                  <tr key={`${row.enrollment_id}-${row.day_of_course}`} className="hover:bg-secondary/5">
                    <td className="py-3 pr-4 font-medium text-light-accent">{row.id_student}</td>
                    <td className="py-3 pr-4 text-light-accent/70">{row.code_module} / {row.code_presentation}</td>
                    <td className="py-3 pr-4 font-mono text-light-accent/70">{row.day_of_course}</td>
                    <td className="py-3 pr-4"><RiskBadge level={row.risk_level} /></td>
                    <td className="py-3 pr-4 font-mono text-light-accent/80">{(row.risk_probability * 100).toFixed(1)}%</td>
                    <td className="py-3 pr-4 text-light-accent/55 max-w-xs truncate">{row.recommended_action || '-'}</td>
                    <td className="py-3 pr-4 text-light-accent/40 font-mono text-xs">{new Date(row.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
}

export function AcademicClockPage() {
  const [clocks, setClocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [globalDay, setGlobalDay] = useState(60);

  const loadClocks = async () => {
    setLoading(true);
    try {
      const { data } = await adminService.getClocks();
      setClocks(data.clocks || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load academic clocks');
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
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-gradient">Academic Clock</h1>
          <p className="text-light-accent/55 text-sm mt-1">Control one simulated day shared by all students and course presentations.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={runPredictions} disabled={running} className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-60">
            {running ? 'Updating...' : 'Update Predictions'}
          </button>
          <button onClick={loadClocks} className="px-3 py-2 rounded-lg border border-border text-sm text-light-accent hover:bg-secondary/10">
            Refresh
          </button>
        </div>
      </motion.div>

      <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
        Changing the academic clock also recomputes demo predictions, so risk levels and student counts refresh for the new day.
      </div>

      <div className="glass rounded-2xl p-6 glow-border space-y-5">
        <div className="flex items-center gap-3">
          <Clock className="w-5 h-5 text-accent" />
          <div>
            <h2 className="font-display font-semibold text-light-accent">Unified Clock Control</h2>
            <p className="text-xs text-light-accent/45">Changes apply to every student because predictions read the course clock before running the model.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button disabled={running} onClick={() => tickAll(1)} className="px-4 py-2 rounded-lg bg-secondary text-white text-sm font-medium disabled:opacity-60">+1 day for all</button>
          <button disabled={running} onClick={() => tickAll(10)} className="px-4 py-2 rounded-lg bg-secondary text-white text-sm font-medium disabled:opacity-60">+10 days for all</button>
          <input
            type="number"
            min="0"
            value={globalDay}
            onChange={(e) => setGlobalDay(e.target.value)}
            className="w-28 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-light-accent focus:outline-none focus:border-accent"
          />
          <button disabled={running} onClick={() => resetAll(Number(globalDay))} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-60">
            <RotateCcw className="w-4 h-4" />
            Set all clocks
          </button>
          <button onClick={runPredictions} disabled={running} className="px-4 py-2 rounded-lg border border-border text-light-accent text-sm font-medium hover:bg-secondary/10 disabled:opacity-60">
            {running ? 'Recomputing...' : 'Recompute after change'}
          </button>
        </div>
      </div>

      <div className="glass rounded-2xl p-5 glow-border">
        <h2 className="font-display font-semibold text-light-accent mb-4">Clock Snapshot</h2>
        {loading ? (
          <div className="h-24 flex items-center justify-center text-light-accent/40">Loading...</div>
        ) : (
          <div className="overflow-x-auto">
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
                  const pct = Math.round((clock.current_day / clock.max_day) * 100);
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
