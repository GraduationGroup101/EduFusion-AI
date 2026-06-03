import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { BookOpen, MousePointerClick, RefreshCw, Save, Sparkles } from 'lucide-react';
import { studentService } from '../services/api';

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getLimits = (row, form = {}) => {
  if (!row) {
    return {
      elapsedDays: 1,
      maxClicks: 50,
      tmaDelayMax: 0,
      cmaDelayMax: 0,
      newDelayMax: 0,
    };
  }

  const currentDay = toNumber(row.current_day, 0);
  const elapsedDays = Math.max(1, currentDay + 1);
  const maxClicks = elapsedDays * 50;
  const tmaDue = row.latest_tma_due_date;
  const cmaDue = row.latest_cma_due_date;
  const nextDue = form.new_submission_type === 'CMA'
    ? row.next_cma_due_date
    : row.next_tma_due_date;

  return {
    elapsedDays,
    maxClicks,
    tmaDelayMax: tmaDue === null || tmaDue === undefined ? 0 : Math.max(0, currentDay - Number(tmaDue)),
    cmaDelayMax: cmaDue === null || cmaDue === undefined ? 0 : Math.max(0, currentDay - Number(cmaDue)),
    newDelayMax: nextDue === null || nextDue === undefined ? 0 : Math.max(0, currentDay - Number(nextDue)),
  };
};

const resetSimulationForm = (row, previous = {}) => ({
  ...row,
  quiz_clicks: 0,
  forum_clicks: 0,
  resource_clicks: 0,
  activity_days: 1,
  latest_tma_score: row.latest_tma_score ?? '',
  tma_delay_days: '',
  latest_cma_score: row.latest_cma_score ?? '',
  cma_delay_days: '',
  new_submission_type: previous.new_submission_type || (row.next_tma_assessment_id ? 'TMA' : row.next_cma_assessment_id ? 'CMA' : 'TMA'),
  new_submission_score: '',
  new_submission_delay_days: '',
});

const NumberInput = ({ label, value, onChange, max, min = 0, disabled = false, hint = '' }) => (
  <label className="space-y-2">
    <span className="text-xs font-mono uppercase text-light-accent/50">{label}</span>
    <input
      value={value ?? ''}
      type="number"
      min={min}
      max={max}
      disabled={disabled}
      onChange={(event) => {
        const next = event.target.value;
        if (next === '') {
          onChange('');
          return;
        }
        onChange(clamp(Number(next), min, max));
      }}
      className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-light-accent focus:outline-none focus:border-accent disabled:opacity-50"
    />
    <p className="text-xs text-light-accent/45">Highest allowed now: {max}{hint ? ` ${hint}` : ''}</p>
  </label>
);

const SummaryCard = ({ label, value }) => (
  <div className="rounded-xl border border-border bg-surface/60 p-4">
    <p className="text-xs font-mono uppercase text-light-accent/45">{label}</p>
    <p className="text-xl font-display font-bold text-light-accent">{value}</p>
  </div>
);

export default function StudentPredictionPage() {
  const [enrollments, setEnrollments] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState({});
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(
    () => enrollments.find((item) => String(item.enrollment_id) === String(selectedId)),
    [enrollments, selectedId]
  );

  const limits = getLimits(selected, form);
  const availableSubmissionTypes = selected
    ? [
        selected.next_tma_assessment_id ? 'TMA' : null,
        selected.next_cma_assessment_id ? 'CMA' : null,
      ].filter(Boolean)
    : [];

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const { data } = await studentService.getPredictionData();
      const rows = data.enrollments || [];
      setEnrollments(rows);
      const first = rows[0];
      if (first) {
        setSelectedId(first.enrollment_id);
        setForm(resetSimulationForm(first));
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load your data');
    } finally {
      setLoading(false);
    }
  };

  const runPrediction = async (target = selected, force = false) => {
    if (!target) return;
    setLoading(true);
    try {
      const { data } = await studentService.getPrediction({
        code_module: target.code_module,
        code_presentation: target.code_presentation,
        force: force ? 1 : 0,
      });
      setPrediction(data);
      toast.success(data.cached ? 'Current prediction loaded' : 'Prediction updated');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to run prediction');
    } finally {
      setLoading(false);
    }
  };

  const saveData = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const payload = {
        quiz_clicks: toNumber(form.quiz_clicks, 0),
        forum_clicks: toNumber(form.forum_clicks, 0),
        resource_clicks: toNumber(form.resource_clicks, 0),
        activity_days: toNumber(form.activity_days, 1),
      };

      if (form.latest_tma_score !== '') payload.latest_tma_score = toNumber(form.latest_tma_score, 0);
      if (form.tma_delay_days !== '') payload.tma_delay_days = toNumber(form.tma_delay_days, 0);
      if (form.latest_cma_score !== '') payload.latest_cma_score = toNumber(form.latest_cma_score, 0);
      if (form.cma_delay_days !== '') payload.cma_delay_days = toNumber(form.cma_delay_days, 0);

      if (availableSubmissionTypes.length > 0 && form.new_submission_score !== '') {
        payload.new_submission_type = form.new_submission_type;
        payload.new_submission_score = toNumber(form.new_submission_score, 0);
        if (form.new_submission_delay_days !== '') {
          payload.new_submission_delay_days = toNumber(form.new_submission_delay_days, 0);
        }
      }

      const { data } = await studentService.updatePredictionData(selected.enrollment_id, payload);
      (data.warnings || []).forEach((message) => toast(message));
      setEnrollments(data.enrollments || []);
      const updated = (data.enrollments || []).find((item) => item.enrollment_id === selected.enrollment_id);
      if (updated) {
        setForm(resetSimulationForm(updated, form));
        await runPrediction(updated, true);
      }
      toast.success('Changes applied');
    } catch (err) {
      toast.error(err.response?.data?.error || err.response?.data?.detail || err.message || 'Failed to save your data');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selected) {
      setForm(resetSimulationForm(selected, form));
      runPrediction(selected);
    }
  }, [selectedId]);

  const summary = selected ? [
    ['Day', selected.current_day],
    ['Total Clicks', selected.total_clicks],
    ['Active Days', selected.active_days],
    ['Days Since Activity', selected.days_since_last_click ?? '-'],
    ['Avg Score', Number(selected.avg_score || 0).toFixed(1)],
    ['Submitted', selected.num_submitted],
    ['Submission Rate', `${Math.round(Number(selected.submission_rate || 0) * 100)}%`],
    ['Late Avg', Number(selected.avg_days_late || 0).toFixed(1)],
  ] : [];

  return (
    <div className="p-6 space-y-6">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-gradient">My Prediction Tool</h1>
          <p className="text-light-accent/55 text-sm mt-1">Try simple changes and see how your risk prediction responds.</p>
        </div>
        <button onClick={() => runPrediction(selected, true)} disabled={loading || !selected} className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm text-light-accent hover:bg-secondary/10 disabled:opacity-60">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Rerun
        </button>
      </motion.div>

      <div className="glass rounded-2xl p-5 glow-border space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="space-y-2 md:col-span-1">
            <span className="text-xs font-mono uppercase text-light-accent/50">Course</span>
            <select
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-light-accent focus:outline-none focus:border-accent"
            >
              {enrollments.map((item) => (
                <option key={item.enrollment_id} value={item.enrollment_id}>
                  {item.code_module} / {item.code_presentation}
                </option>
              ))}
            </select>
          </label>
        </div>

        {selected ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {summary.map(([label, value]) => (
                <SummaryCard key={label} label={label} value={value} />
              ))}
            </div>

            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
              These are simple what-if inputs. Activity means extra interactions with the course platform up to the current day. The maximum is based on day {selected.current_day}.
            </div>

            <div className="rounded-2xl border border-border bg-surface/40 p-5 space-y-4">
              <div className="flex items-center gap-2">
                <MousePointerClick className="w-5 h-5 text-accent" />
                <h2 className="font-display text-sm font-semibold text-light-accent">1. Add Learning Activity</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <NumberInput label="Extra Quiz Activity" value={form.quiz_clicks} max={limits.maxClicks} onChange={(value) => setField('quiz_clicks', value)} hint="interactions" />
                <NumberInput label="Extra Forum Activity" value={form.forum_clicks} max={limits.maxClicks} onChange={(value) => setField('forum_clicks', value)} hint="interactions" />
                <NumberInput label="Extra Resource Study" value={form.resource_clicks} max={limits.maxClicks} onChange={(value) => setField('resource_clicks', value)} hint="interactions" />
                <NumberInput label="Days You Were Active" value={form.activity_days} min={1} max={limits.elapsedDays} onChange={(value) => setField('activity_days', value || 1)} hint="days" />
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-surface/40 p-5 space-y-4">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-accent" />
                <h2 className="font-display text-sm font-semibold text-light-accent">2. Update Latest Grades</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <NumberInput label="TMA Score" value={form.latest_tma_score} max={100} disabled={!selected.latest_tma_id} onChange={(value) => setField('latest_tma_score', value)} />
                <NumberInput label="TMA Late Days" value={form.tma_delay_days} max={limits.tmaDelayMax} disabled={!selected.latest_tma_id} onChange={(value) => setField('tma_delay_days', value)} />
                <NumberInput label="CMA Score" value={form.latest_cma_score} max={100} disabled={!selected.latest_cma_id} onChange={(value) => setField('latest_cma_score', value)} />
                <NumberInput label="CMA Late Days" value={form.cma_delay_days} max={limits.cmaDelayMax} disabled={!selected.latest_cma_id} onChange={(value) => setField('cma_delay_days', value)} />
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-surface/40 p-5 space-y-4">
              <h2 className="font-display text-sm font-semibold text-light-accent">3. Add a New Submission</h2>
              {availableSubmissionTypes.length === 0 ? (
                <div className="rounded-xl border border-border bg-surface/70 px-4 py-3 text-sm text-light-accent/60">
                  No unsubmitted TMA/CMA is available for this course right now.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label className="space-y-2">
                    <span className="text-xs font-mono uppercase text-light-accent/50">Submission Type</span>
                    <select
                      value={form.new_submission_type}
                      onChange={(event) => setField('new_submission_type', event.target.value)}
                      className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-light-accent focus:outline-none focus:border-accent"
                    >
                      {availableSubmissionTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </label>
                  <NumberInput label="Score" value={form.new_submission_score} max={100} onChange={(value) => setField('new_submission_score', value)} />
                  <NumberInput label="Late Days" value={form.new_submission_delay_days} max={limits.newDelayMax} onChange={(value) => setField('new_submission_delay_days', value)} />
                </div>
              )}
            </div>

            <button onClick={saveData} disabled={saving} className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              <Save className="w-4 h-4" />
              {saving ? 'Applying...' : 'Apply and Rerun'}
            </button>
          </>
        ) : (
          <div className="h-24 flex items-center justify-center text-light-accent/40">
            {loading ? 'Loading...' : 'No enrollments found'}
          </div>
        )}
      </div>

      {prediction && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-6 glow-border space-y-5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent" />
            <h2 className="font-display font-semibold text-light-accent">Current Prediction</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs font-mono uppercase text-light-accent/45">Risk Level</p>
              <p className="text-2xl font-display font-bold text-light-accent">{prediction.risk_level}</p>
            </div>
            <div>
              <p className="text-xs font-mono uppercase text-light-accent/45">Probability</p>
              <p className="text-2xl font-display font-bold text-light-accent">{(prediction.risk_probability * 100).toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-xs font-mono uppercase text-light-accent/45">At Risk</p>
              <p className="text-2xl font-display font-bold text-light-accent">{prediction.at_risk ? 'Yes' : 'No'}</p>
            </div>
            <div>
              <p className="text-xs font-mono uppercase text-light-accent/45">Day</p>
              <p className="text-2xl font-display font-bold text-light-accent">{prediction.model_confidence?.day_of_course}</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-mono uppercase text-light-accent/45 mb-2">Reasons</p>
            <ul className="space-y-2">
              {(prediction.explanation || []).map((item, index) => (
                <li key={index} className="rounded-xl border border-border bg-surface/70 px-4 py-3 text-sm text-light-accent/75">{item}</li>
              ))}
            </ul>
          </div>
        </motion.div>
      )}
    </div>
  );
}
