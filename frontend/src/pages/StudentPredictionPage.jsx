import PageHeader from '../components/ui/PageHeader';
import StatusBadge from '../components/ui/StatusBadge';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import ScenarioBuilder from '../components/edupredict/ScenarioBuilder';
import ScenarioResults from '../components/edupredict/ScenarioResults';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { BookOpen, Eraser, RefreshCw, Save, Sparkles } from 'lucide-react';
import { studentService } from '../services/api';
import { buildPayload, defaultForm, describeChanges, formFromInputs, formatPercent, hasChanges } from '../lib/scenario';

const USABLE_STATES = ['current', 'needs_reevaluation'];

// The model service may describe a reason as text or as {feature, description};
// either way the student sees readable text, never a crashed page.
const reasonList = (value) => (Array.isArray(value) ? value : [])
  .map((item) => (typeof item === 'string' ? item : item?.description || item?.text || item?.feature || ''))
  .map((item) => String(item).trim()).filter(Boolean);

export default function StudentPredictionPage() {
  const [enrollments, setEnrollments] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [status, setStatus] = useState(null);
  const [scenarioPrediction, setScenarioPrediction] = useState(null);
  const [scenarioError, setScenarioError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmActual,setConfirmActual]=useState(false);
  const [deleting, setDeleting] = useState(false);
  const predictionRequest = useRef(null);
  const scenarioRequest = useRef(null);
  const scenarioPredictionRequest = useRef(null);

  const selected = useMemo(
    () => enrollments.find((item) => String(item.enrollment_id) === String(selectedId)),
    [enrollments, selectedId]
  );
  const payload = selected && form ? buildPayload(form, selected) : null;
  const canSave = Boolean(payload && hasChanges(payload));
  const busy = saving || deleting;

  const loadData = async (signal) => {
    setLoading(true);
    try {
      const { data } = await studentService.getPredictionData({ signal });
      if (signal.aborted) return;
      const rows = data.enrollments || [];
      setEnrollments(rows);
      if (rows[0]) setSelectedId(rows[0].enrollment_id);
    } catch (err) {
      if (!signal.aborted) toast.error(err.response?.data?.error || 'Failed to load your data');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  };

  const runPrediction = async (target = selected, force = false) => {
    if (!target) return;
    predictionRequest.current?.abort();
    const controller = new AbortController();
    predictionRequest.current = controller;
    setLoading(true);
    try {
      const { data } = await studentService.getPrediction({
        code_module: target.code_module,
        code_presentation: target.code_presentation,
        force: force ? 1 : 0,
      }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setPrediction(data);
      toast.success(data.cached ? 'Current prediction loaded' : 'Prediction updated');
    } catch (err) {
      if (!controller.signal.aborted) toast.error(err.response?.data?.error || 'Failed to run prediction');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const evaluateScenario = async (enrollmentId) => {
    scenarioPredictionRequest.current?.abort();
    const controller = new AbortController();
    scenarioPredictionRequest.current = controller;
    setScenarioPrediction(null);
    setScenarioError('');
    try {
      const { data } = await studentService.getScenarioPrediction(enrollmentId, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setScenarioPrediction(data);
      if (data.status) setStatus(data.status);
    } catch (err) {
      if (controller.signal.aborted) return;
      const body = err.response?.data;
      // A stale or invalid scenario is a state, not an outage: show it as such.
      if (body?.status?.state) setStatus(body.status);
      else setScenarioError(body?.error || 'Hypothetical risk could not be evaluated. Try again.');
    }
  };

  // Shared by "Save & evaluate" and by updating a stale scenario to today.
  const applyScenario = async (inputs, { reevaluating = false } = {}) => {
    if (!selected) return;
    scenarioRequest.current?.abort();
    scenarioPredictionRequest.current?.abort();
    setScenarioPrediction(null);
    setScenarioError('');
    const enrollmentId = selected.enrollment_id;
    setSaving(true);
    try {
      const { data } = await studentService.saveScenario(enrollmentId, inputs);
      setScenario(data.scenario);
      setStatus({ state: 'current', reasons: [], based_on_day: data.scenario.based_on_day, current_day: data.scenario.based_on_day });
      setForm(formFromInputs(selected, data.scenario.inputs));
      toast.success(reevaluating ? 'Scenario updated. Your academic records are unchanged.' : 'Scenario saved. Your academic records are unchanged.');
      await evaluateScenario(enrollmentId);
    } catch (err) {
      const message = err.response?.data?.error || err.response?.data?.detail || err.message || 'Failed to save your scenario';
      if (reevaluating && err.response?.status === 400) {
        setStatus((previous) => ({ ...(previous || {}), state: 'invalid', reasons: [message] }));
      } else {
        toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  };

  const saveData = () => { if (payload) applyScenario(payload); };
  const reevaluate = () => { if (scenario) applyScenario(scenario.inputs, { reevaluating: true }); };
  const clearControls = () => { if (selected) setForm(defaultForm(selected)); };

  const clearScenarioState = () => {
    scenarioPredictionRequest.current?.abort();
    setScenario(null);
    setStatus(null);
    setScenarioPrediction(null);
    setScenarioError('');
    if (selected) setForm(defaultForm(selected));
  };

  const deleteSaved = async () => {
    if (!selected) return;
    setDeleting(true);
    try {
      await studentService.deleteScenario(selected.enrollment_id);
      clearScenarioState();
      setConfirmDelete(false);
      toast.success('Scenario deleted. Your actual prediction is unchanged.');
    } catch (err) {
      if (err.response?.status === 404) {
        clearScenarioState();
        setConfirmDelete(false);
        toast.success('Scenario already removed. Your actual prediction is unchanged.');
      } else {
        toast.error(err.response?.data?.error || 'Failed to delete the scenario');
      }
    } finally {
      setDeleting(false);
    }
  };

  const saveActual=async()=>{
    if(!selected||!scenario?.revision)return;
    setSaving(true);
    try {
      const {data}=await studentService.applyScenarioActual(selected.enrollment_id,scenario.revision);
      setScenario(data.scenario);setConfirmActual(false);
      const fresh=await studentService.getPredictionData();
      setEnrollments(fresh.data.enrollments||[]);
      toast.success(data.message);
    }catch(error){toast.error(error.response?.data?.error||'Unable to apply the scenario. Please reload and try again.');}
    finally{setSaving(false);}
  };

  const togglePlan = async () => {
    if (!selected || !scenario) return;
    try {
      const { data } = await studentService.setScenarioPlan(selected.enrollment_id, !scenario.plan);
      setScenario(data.scenario);
      toast.success(data.message || 'Learning plan updated.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update the learning plan');
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    scenarioRequest.current = controller;
    if (selected) {
      setForm(defaultForm(selected));
      setPrediction(null);
      setScenario(null);
      setStatus(null);
      setScenarioPrediction(null);
      setScenarioError('');
      runPrediction(selected);
      studentService.getScenario(selected.enrollment_id, { signal: controller.signal }).then(({ data }) => {
        if (controller.signal.aborted) return;
        const saved = data.scenario?.data || null;
        setScenario(saved);
        setStatus(data.status || null);
        if (saved) {
          setForm(formFromInputs(selected, saved.inputs));
          if(saved.prediction_available && (saved.applied_at||data.status?.state==='current'))setScenarioPrediction({...saved.prediction,based_on_day:saved.based_on_day});
          else if (!saved.applied_at&&(!data.status || USABLE_STATES.includes(data.status.state))) evaluateScenario(selected.enrollment_id);
        }
      }).catch((error) => {
        if (!controller.signal.aborted) toast.error(error.response?.data?.error || 'Saved scenario could not be loaded');
      });
    }
    return () => { controller.abort(); predictionRequest.current?.abort(); scenarioPredictionRequest.current?.abort(); };
  }, [selected]);

  const evidence = selected ? [
    ['Course day', selected.current_day],
    ['Interactions', selected.total_clicks],
    ['Active days', selected.active_days],
    ['Days since last activity', selected.days_since_last_click ?? '—'],
    ['Average score', Number(selected.avg_score || 0).toFixed(1)],
    ['Submitted', selected.num_submitted],
    ['Submission rate', `${Math.round(Number(selected.submission_rate || 0) * 100)}%`],
    ['Average days late', Number(selected.avg_days_late || 0).toFixed(1)],
  ] : [];
  const pendingChanges = payload ? describeChanges(payload, selected) : [];

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="EduPredict" icon={BookOpen} description="See your actual academic prediction, then explore a separate what-if scenario without changing any records.">
        <button onClick={() => runPrediction(selected, true)} disabled={loading || !selected} className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm text-light-accent disabled:opacity-60"><RefreshCw className={loading ? 'animate-spin' : ''} size={16} />Rerun actual prediction</button>
      </PageHeader>

      <div className="glass rounded-2xl p-5 glow-border space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="space-y-2 md:col-span-1">
            <span className="text-xs font-mono uppercase text-light-accent/50">Course</span>
            <select
              value={selectedId}
              disabled={busy}
              onChange={(event) => setSelectedId(event.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-light-accent focus:outline-none focus:border-secondary"
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
            <div>
              <p className="text-xs font-mono uppercase text-light-accent/45 mb-2">Your records today</p>
              <div className="evidence-grid">
                {evidence.map(([label, value]) => (
                  <div key={label} className="evidence-cell"><p>{label}</p><p>{value}</p></div>
                ))}
              </div>
            </div>

            {prediction ? (
              <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-border bg-surface/40 p-5 space-y-4" aria-label="Actual academic prediction">
                <div className="flex flex-wrap items-center gap-3">
                  <Sparkles className="w-5 h-5 text-accent" aria-hidden="true" />
                  <h2 className="font-display font-semibold text-light-accent">Actual academic prediction</h2>
                  <StatusBadge status="success">From real records</StatusBadge>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs font-mono uppercase text-light-accent/45">Risk level</p>
                    <p className="text-2xl font-display font-bold text-light-accent">{prediction.risk_level}</p>
                  </div>
                  <div>
                    <p className="text-xs font-mono uppercase text-light-accent/45">Probability</p>
                    <p className="text-2xl font-display font-bold text-light-accent">{formatPercent(prediction.risk_probability)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-mono uppercase text-light-accent/45">At risk</p>
                    <p className="text-2xl font-display font-bold text-light-accent">{prediction.at_risk ? 'Yes' : 'No'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-mono uppercase text-light-accent/45">Day</p>
                    <p className="text-2xl font-display font-bold text-light-accent">{prediction.day_of_course ?? prediction.model_confidence?.day_of_course ?? selected.current_day}</p>
                  </div>
                </div>
                {reasonList(prediction.explanation).length > 0 && (
                  <div>
                    <p className="text-xs font-mono uppercase text-light-accent/45 mb-2">Reasons</p>
                    <ul className="space-y-2">
                      {reasonList(prediction.explanation).map((item, index) => (
                        <li key={index} className="rounded-xl border border-border bg-surface/70 px-4 py-3 text-sm text-light-accent/75">{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </motion.section>
            ) : (
              <p className="text-sm text-light-accent/50">{loading ? 'Loading your actual prediction…' : 'Your actual prediction is not available right now.'}</p>
            )}
          </>
        ) : (
          <div className="h-24 flex items-center justify-center text-light-accent/40">
            {loading ? 'Loading...' : 'No enrollments found'}
          </div>
        )}
      </div>

      {selected && form && (
        <div className="glass rounded-2xl p-5 glow-border space-y-5">
          <div>
            <h2 className="font-display font-semibold text-light-accent">What would you like to explore?</h2>
            <p className="text-sm text-light-accent/65 mt-1">Build a what-if scenario in a minute. It is stored separately and never changes your grades, activity or actual prediction.</p>
          </div>

          <ScenarioBuilder row={selected} form={form} onChange={setForm} disabled={busy} />

          <div className="scenario-actions">
            <button type="button" onClick={saveData} disabled={busy || !canSave} className="button-primary-sm" title={canSave ? undefined : 'Choose at least one change first'}>
              <Save size={14} aria-hidden="true" />
              {saving ? 'Saving...' : 'Save & evaluate scenario'}
            </button>
            <button type="button" onClick={clearControls} disabled={busy} className="button-outline">
              <Eraser size={14} aria-hidden="true" />Clear controls
            </button>
            {!canSave && <span className="text-xs text-light-accent/50">Choose at least one change to evaluate a scenario.</span>}
            {canSave && scenario && pendingChanges.length > 0 && <span className="text-xs text-light-accent/50">Saving replaces your current saved scenario.</span>}
          </div>
        </div>
      )}

      {selected && (
        <ScenarioResults
          row={selected}
          prediction={prediction}
          scenario={scenario}
          status={status}
          scenarioPrediction={scenarioPrediction}
          scenarioError={scenarioError}
          busy={busy}
          onReevaluate={reevaluate}
          onDelete={() => setConfirmDelete(true)}
          onTogglePlan={togglePlan}
          onApplyActual={() => setConfirmActual(true)}
        />
      )}

      <ConfirmDialog open={confirmActual} title="Apply scenario to actual data?"
        description="This explicitly replaces the affected academic values and saves the corresponding actual prediction. Review the changes before applying."
        confirmLabel="Apply to actual data" busy={saving} onConfirm={saveActual} onCancel={()=>{if(!saving)setConfirmActual(false);}}>
        {scenario && <ul>{describeChanges(scenario.inputs||{},selected).map(change=><li key={change}>{change}</li>)}</ul>}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this what-if scenario?"
        description="Only the saved scenario is removed. Your grades, activity and actual academic prediction stay exactly as they are."
        confirmLabel="Delete scenario"
        busy={deleting}
        onConfirm={deleteSaved}
        onCancel={() => setConfirmDelete(false)}
      >
        {scenario && describeChanges(scenario.inputs || {}, selected).length > 0 && (
          <ul>{describeChanges(scenario.inputs || {}, selected).map((change) => <li key={change}>{change}</li>)}</ul>
        )}
      </ConfirmDialog>
    </div>
  );
}
