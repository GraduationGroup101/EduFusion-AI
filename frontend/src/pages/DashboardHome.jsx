import StatusBadge from '../components/ui/StatusBadge';
import PageHeader from '../components/ui/PageHeader';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { dashboardService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Users, BookOpen, AlertTriangle, TrendingUp } from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const RISK_COLORS = { HIGH: '#b42332', MEDIUM: '#ad791f', LOW: '#398461' };

const StatCard = ({ icon: Icon, label, value, color, delay }) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay }}
    className={`glass rounded-2xl p-5 metric-card ${color === "#b42332" ? "is-risk" : ""}`}
  >
    <div className="flex items-start justify-between">
      <div>
        <p className="text-light-accent/50 text-xs font-mono uppercase tracking-wider mb-1">{label}</p>
        <p className="font-display text-3xl font-bold text-light-accent">
          {value?.toLocaleString() ?? '—'}
        </p>
      </div>
      <div className="metric-icon w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}20` }}>
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
    </div>
  </motion.div>
);

export default function DashboardHome() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [studentSummary, setStudentSummary] = useState(null);
  const [predictions, setPredictions] = useState([]);
  const [riskDist, setRiskDist] = useState([]);
  const [courseStats, setCourseStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true); setLoadError('');
      try {
        if (user?.role === 'student') {
          const { data } = await dashboardService.getStudentSummary();
          if (!cancelled) { setStudentSummary(data); setPredictions(data.predictions || []); }
          return;
        }
        const results = await Promise.allSettled([
          dashboardService.getStats(), dashboardService.getRecentPredictions(8),
          dashboardService.getRiskDistribution(), dashboardService.getCourseStats(),
        ]);
        if (cancelled) return;
        if (results[0].status === 'fulfilled') setStats(results[0].value.data);
        if (results[1].status === 'fulfilled') setPredictions(results[1].value.data);
        if (results[2].status === 'fulfilled') setRiskDist(results[2].value.data.map(d => ({ name: d.risk_level, value: parseInt(d.count) })));
        if (results[3].status === 'fulfilled') setCourseStats(results[3].value.data.map(d => ({ name: d.code_module, enrollments: parseInt(d.enrollments) })));
        if (results.some(result => result.status === 'rejected')) setLoadError('Some dashboard data could not be loaded. Previously loaded values may be out of date.');
      } catch {
        if (!cancelled) setLoadError('Your academic data could not be loaded. Please try again.');
      } finally { if (!cancelled) setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [user?.role, reload]);
  const errorNotice = loadError && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm">
    <p>{loadError}</p><button onClick={() => setReload(value => value + 1)} className="mt-2 underline">Try again</button>
  </div>;

  if (user?.role === 'student') {
    const highestRisk = studentSummary?.highestRisk;

    return (
      <div className="p-6 space-y-6">
        {errorNotice}
        <PageHeader title="My Academic Status" description={`Welcome back, ${user?.student_name || user?.username}. Your learning, in perspective.`}><StatusBadge status="neutral">Private workspace</StatusBadge></PageHeader>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard icon={BookOpen} label="My Enrollments" value={studentSummary?.totalEnrollments} color="#087F75" delay={0.1} />
          <StatCard icon={TrendingUp} label="My Predictions" value={studentSummary?.predictionCount} color="#C85140" delay={0.15} />
          <StatCard icon={AlertTriangle} label="At-Risk Courses" value={studentSummary?.atRiskCount} color="#b42332" delay={0.2} />
        </div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="glass rounded-2xl p-5 glow-border">
          <h3 className="font-display text-sm font-semibold text-light-accent mb-4">Current Risk Summary</h3>
          {highestRisk ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-light-accent/40 text-xs font-mono uppercase mb-1">Course</p>
                <p className="text-light-accent font-medium">{highestRisk.code_module} / {highestRisk.code_presentation}</p>
              </div>
              <div>
                <p className="text-light-accent/40 text-xs font-mono uppercase mb-1">Risk Level</p>
                <p className="text-light-accent font-medium">{highestRisk.risk_level}</p>
              </div>
              <div>
                <p className="text-light-accent/40 text-xs font-mono uppercase mb-1">Probability</p>
                <p className="text-light-accent font-medium">{(highestRisk.risk_probability * 100).toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-light-accent/40 text-xs font-mono uppercase mb-1">Day</p>
                <p className="text-light-accent font-medium">{highestRisk.day_of_course}</p>
              </div>
            </div>
          ) : (
            <div className="h-24 flex items-center justify-center text-light-accent/30 text-sm">
              {loading ? 'Loading...' : 'No prediction yet. Ask the chatbot about your academic status.'}
            </div>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="glass rounded-2xl p-5 glow-border">
          <h3 className="font-display text-sm font-semibold text-light-accent mb-4">My Courses</h3>
          {studentSummary?.enrollments?.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {studentSummary.enrollments.map((item) => (
                <div key={item.enrollment_id} className="border border-border rounded-xl p-4 bg-surface/30">
                  <p className="text-light-accent font-medium">{item.code_module}</p>
                  <p className="text-light-accent/40 text-xs font-mono">{item.code_presentation}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-24 flex items-center justify-center text-light-accent/30 text-sm">No enrollments found</div>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {errorNotice}
      {/* Header */}
      <PageHeader title="Dashboard" description={`Welcome back, ${user?.username}. A clearer view of academic progress.`}><StatusBadge status={loading ? "checking" : loadError ? "warning" : "success"}>{loading ? "Refreshing data" : loadError ? "Check connection" : "Up to date"}</StatusBadge></PageHeader>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total Students" value={stats?.totalStudents} color="#087F75" delay={0.1} />
        <StatCard icon={BookOpen} label="Enrollments" value={stats?.totalEnrollments} color="#C85140" delay={0.15} />
        <StatCard icon={TrendingUp} label="Current Predictions" value={stats?.recentPredictions} color="#087F75" delay={0.2} />
        <StatCard icon={AlertTriangle} label="Current At-Risk Courses" value={stats?.atRiskStudents} color="#b42332" delay={0.25} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Risk Distribution Pie */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="glass rounded-2xl p-5 glow-border">
          <h3 className="font-display text-sm font-semibold text-light-accent mb-4">Risk Distribution</h3>
          {riskDist.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie isAnimationActive={false} data={riskDist} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value">
                  {riskDist.map((entry, i) => (
                    <Cell key={i} fill={RISK_COLORS[entry.name.toUpperCase()] || '#087F75'} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #DDE6DF', borderRadius: 8, color: '#193C37', fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-40 flex items-center justify-center text-light-accent/30 text-sm">No data</div>
          )}
          <ul aria-label="Risk distribution legend" className="flex flex-wrap gap-2 mt-2">
            {Object.entries(RISK_COLORS).map(([k, v]) => (
              <li key={k} className="flex items-center gap-1 text-xs text-light-accent/60">
                <span className="w-2 h-2 rounded-full" style={{ background: v }} />
                {k[0] + k.slice(1).toLowerCase()}
              </li>
            ))}
          </ul>
        </motion.div>

        {/* Course Enrollment Bar */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
          className="glass rounded-2xl p-5 glow-border lg:col-span-2">
          <h3 className="font-display text-sm font-semibold text-light-accent mb-4">Enrollments by Course</h3>
          {courseStats.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={courseStats}>
                <XAxis dataKey="name" tick={{ fill: '#193C37', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#087F75', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #DDE6DF', borderRadius: 8, color: '#193C37', fontSize: 12 }} />
                <Bar isAnimationActive={false} dataKey="enrollments" fill="#087F75" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-40 flex items-center justify-center text-light-accent/30 text-sm">No data</div>
          )}
        </motion.div>
      </div>

      {/* Recent Predictions Table */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
        className="glass rounded-2xl p-5 glow-border">
        <h3 className="font-display text-sm font-semibold text-light-accent mb-4">Recent Predictions</h3>
        {predictions.length > 0 ? (
          <div className="table-scroll" role="region" aria-label="Recent predictions" tabIndex={0}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border">
                  {['Student', 'Course', 'Risk Level', 'Probability', 'Action', 'Date'].map(h => (
                    <th key={h} className="pb-3 pr-4 text-xs font-mono text-muted uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {predictions.map((p) => (
                  <tr key={p.id} className="hover:bg-white/5 transition-colors">
                    <td className="py-3 pr-4 text-light-accent font-medium">{p.student_name || '—'}</td>
                    <td className="py-3 pr-4 text-light-accent/60 font-mono text-xs">{p.code_module}</td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={p.risk_level} />
                    </td>
                    <td className="py-3 pr-4 text-light-accent/70 font-mono text-xs">
                      {p.risk_probability != null ? `${(p.risk_probability * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td className="py-3 pr-4 text-light-accent/50 text-xs table-action">{p.recommended_action || '—'}</td>
                    <td className="py-3 text-light-accent/30 text-xs font-mono">
                      {new Date(p.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-24 flex items-center justify-center text-light-accent/30 text-sm">
            {loading ? 'Loading...' : 'No predictions yet'}
          </div>
        )}
      </motion.div>
    </div>
  );
}
