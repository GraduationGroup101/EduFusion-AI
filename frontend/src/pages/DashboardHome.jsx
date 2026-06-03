import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { dashboardService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Users, BookOpen, AlertTriangle, TrendingUp, Activity } from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const RISK_COLORS = {
  HIGH: '#ef4444',
  MEDIUM: '#f59e0b',
  LOW: '#22c55e',
  High: '#ef4444',
  Medium: '#f59e0b',
  Low: '#22c55e',
};

const StatCard = ({ icon: Icon, label, value, color, delay }) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay }}
    className="glass rounded-2xl p-6 glow-border hover:border-accent/30 transition-colors"
  >
    <div className="flex items-start justify-between">
      <div>
        <p className="text-light-accent/50 text-xs font-mono uppercase tracking-wider mb-1">{label}</p>
        <p className="font-display text-3xl font-bold text-light-accent">
          {value?.toLocaleString() ?? '—'}
        </p>
      </div>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}20` }}>
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

  useEffect(() => {
    const load = async () => {
      try {
        if (user?.role === 'student') {
          const summary = await dashboardService.getStudentSummary();
          setStudentSummary(summary.data);
          setPredictions(summary.data.predictions || []);
          return;
        }

        const [s, p, r, c] = await Promise.all([
          dashboardService.getStats(),
          dashboardService.getRecentPredictions(8),
          dashboardService.getRiskDistribution(),
          dashboardService.getCourseStats(),
        ]);
        setStats(s.data);
        setPredictions(p.data);
        setRiskDist(r.data.map(d => ({ name: d.risk_level, value: parseInt(d.count) })));
        setCourseStats(c.data.map(d => ({ name: d.code_module, enrollments: parseInt(d.enrollments), risk: parseFloat(d.avg_risk || 0).toFixed(2) })));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user?.role]);

  if (user?.role === 'student') {
    const highestRisk = studentSummary?.highestRisk;

    return (
      <div className="p-6 space-y-6">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-gradient">My Academic Status</h1>
            <p className="text-light-accent/40 text-sm mt-0.5">
              Welcome back, <span className="text-accent">{user?.student_name || user?.username}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20">
            <Activity className="w-3.5 h-3.5 text-accent" />
            <span className="text-xs font-mono text-accent">Private</span>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard icon={BookOpen} label="My Enrollments" value={studentSummary?.totalEnrollments} color="#76ABAE" delay={0.1} />
          <StatCard icon={TrendingUp} label="My Predictions" value={studentSummary?.predictionCount} color="#FF5722" delay={0.15} />
          <StatCard icon={AlertTriangle} label="At-Risk Courses" value={studentSummary?.atRiskCount} color="#ef4444" delay={0.2} />
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
      {/* Header */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-gradient">Dashboard</h1>
          <p className="text-light-accent/40 text-sm mt-0.5">
            Welcome back, <span className="text-accent">{user?.username}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20">
          <Activity className="w-3.5 h-3.5 text-accent" />
          <span className="text-xs font-mono text-accent">Live</span>
        </div>
      </motion.div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total Students" value={stats?.totalStudents} color="#76ABAE" delay={0.1} />
        <StatCard icon={BookOpen} label="Enrollments" value={stats?.totalEnrollments} color="#FF5722" delay={0.15} />
        <StatCard icon={TrendingUp} label="Predictions (30d)" value={stats?.recentPredictions} color="#76ABAE" delay={0.2} />
        <StatCard icon={AlertTriangle} label="At-Risk (7d)" value={stats?.atRiskStudents} color="#ef4444" delay={0.25} />
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
                <Pie data={riskDist} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value">
                  {riskDist.map((entry, i) => (
                    <Cell key={i} fill={RISK_COLORS[entry.name] || '#76ABAE'} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #D7E3E4', borderRadius: 8, color: '#222831', fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-40 flex items-center justify-center text-light-accent/30 text-sm">No data</div>
          )}
          <div className="flex flex-wrap gap-2 mt-2">
            {Object.entries(RISK_COLORS).map(([k, v]) => (
              <span key={k} className="flex items-center gap-1 text-xs text-light-accent/60">
                <span className="w-2 h-2 rounded-full" style={{ background: v }} />
                {k}
              </span>
            ))}
          </div>
        </motion.div>

        {/* Course Enrollment Bar */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
          className="glass rounded-2xl p-5 glow-border lg:col-span-2">
          <h3 className="font-display text-sm font-semibold text-light-accent mb-4">Enrollments by Course</h3>
          {courseStats.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={courseStats}>
                <XAxis dataKey="name" tick={{ fill: '#222831', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#76ABAE', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #D7E3E4', borderRadius: 8, color: '#222831', fontSize: 12 }} />
                <Bar dataKey="enrollments" fill="#76ABAE" radius={[4, 4, 0, 0]} />
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border">
                  {['Student', 'Course', 'Risk Level', 'Probability', 'Action', 'Date'].map(h => (
                    <th key={h} className="pb-3 pr-4 text-xs font-mono text-accent/60 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {predictions.map((p) => (
                  <tr key={p.id} className="hover:bg-white/5 transition-colors">
                    <td className="py-3 pr-4 text-light-accent font-medium">{p.student_name || '—'}</td>
                    <td className="py-3 pr-4 text-light-accent/60 font-mono text-xs">{p.code_module}</td>
                    <td className="py-3 pr-4">
                      <span className={`px-2 py-0.5 rounded-md text-xs font-medium
                        ${p.risk_level === 'High' ? 'bg-red-500/20 text-red-400' :
                          p.risk_level === 'Medium' ? 'bg-amber-500/20 text-amber-400' :
                          'bg-green-500/20 text-green-400'}`}>
                        {p.risk_level}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-light-accent/70 font-mono text-xs">
                      {p.risk_probability ? `${(p.risk_probability * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td className="py-3 pr-4 text-light-accent/50 text-xs max-w-xs truncate">{p.recommended_action || '—'}</td>
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
