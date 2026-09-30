import { ArrowDown, ArrowUp, Flag, FlagOff, Minus, RefreshCw, Trash2 } from 'lucide-react';
import StatusBadge from '../ui/StatusBadge';
import { compareRisk, describeChanges, formatPercent, planSteps } from '../../lib/scenario';

const STATES = {
  current: { badge: 'success', label: 'Current' },
  needs_reevaluation: { badge: 'warning', label: 'Records changed', tone: 'neutral', title: 'Your records changed since this scenario was saved' },
  stale: { badge: 'warning', label: 'Out of date', tone: 'warning', title: 'This scenario is out of date' },
  invalid: { badge: 'error', label: 'No longer applies', tone: 'danger', title: 'This scenario no longer applies' },
};

const DeltaIcon = ({ direction }) => {
  const Icon = direction === 'lower' ? ArrowDown : direction === 'higher' ? ArrowUp : Minus;
  return <Icon size={22} aria-hidden="true" />;
};

export default function ScenarioResults({ row, prediction, scenario, status, scenarioPrediction, scenarioError, busy = false, onReevaluate, onDelete, onTogglePlan }) {
  if (!scenario) return null;
  const state = STATES[status?.state] ? status.state : 'current';
  const copy = STATES[state];
  const usable = state === 'current' || state === 'needs_reevaluation';
  const comparison = usable && prediction && scenarioPrediction ? compareRisk(prediction.risk_probability, scenarioPrediction.risk_probability) : null;
  const changes = describeChanges(scenario.inputs || {}, row);
  const steps = planSteps(scenario.inputs || {}, row);

  return (
    <div className="space-y-4">
      <section className="glass rounded-2xl p-5 space-y-4" aria-label="Saved scenario">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display font-semibold text-light-accent">Saved what-if scenario</h2>
            <StatusBadge status={copy.badge}>{copy.label}</StatusBadge>
          </div>
          <p className="text-xs text-light-accent/50">Built on course day {scenario.based_on_day}</p>
        </div>
        {changes.length ? (
          <ul className="space-y-1 text-sm text-light-accent/80 list-disc pl-5">{changes.map((change) => <li key={change}>{change}</li>)}</ul>
        ) : (
          <p className="text-sm text-light-accent/60">This scenario makes no changes, so its estimate matches your actual prediction.</p>
        )}
        {state !== 'current' && (
          <div className={`status-banner ${copy.tone}`} role="status">
            <strong>{copy.title}</strong>
            {(status?.reasons || []).map((reason) => <span key={reason}>{reason}</span>)}
            {state === 'stale' && <span>Its estimate is hidden because the model must not reuse an old course day. Update it to today, or delete it.</span>}
            {state === 'invalid' && <span>Build a new scenario above, or delete this one.</span>}
            {state === 'needs_reevaluation' && <span>The estimate below already uses today&apos;s records with your saved changes. Re-evaluate to refresh the summary.</span>}
          </div>
        )}
        <div className="scenario-actions">
          {state === 'stale' && (
            <button type="button" className="button-primary-sm" onClick={onReevaluate} disabled={busy}><RefreshCw size={14} aria-hidden="true" />Update to day {status.current_day}</button>
          )}
          {state === 'needs_reevaluation' && (
            <button type="button" className="button-primary-sm" onClick={onReevaluate} disabled={busy}><RefreshCw size={14} aria-hidden="true" />Re-evaluate with today&apos;s records</button>
          )}
          <button type="button" className="button-danger-outline" onClick={onDelete} disabled={busy}><Trash2 size={14} aria-hidden="true" />Delete scenario</button>
        </div>
      </section>

      {scenarioError && <p role="alert" className="status-banner warning">{scenarioError}</p>}

      {comparison && (
        <section className="glass rounded-2xl p-5 space-y-4" aria-label="Scenario comparison">
          <h2 className="font-display font-semibold text-light-accent">Current vs scenario</h2>
          <div className="compare-grid">
            <div className="compare-cell actual">
              <p className="compare-label">Current risk</p>
              <p className="compare-value">{formatPercent(prediction.risk_probability)}</p>
              <div><StatusBadge status={prediction.risk_level} /></div>
              <p className="text-xs text-light-accent/50">From your real academic records</p>
            </div>
            <div className="compare-cell scenario">
              <p className="compare-label">Scenario risk</p>
              <p className="compare-value">{formatPercent(scenarioPrediction.risk_probability)}</p>
              <div><StatusBadge status={scenarioPrediction.risk_level} /></div>
              <p className="text-xs text-light-accent/50">Hypothetical, from your saved changes</p>
            </div>
            <div className="compare-cell delta">
              <p className="compare-label">Change</p>
              <p className={`compare-value compare-delta ${comparison.direction}`}>
                <DeltaIcon direction={comparison.direction} />
                <span>{comparison.direction === 'same' ? 'No change' : `${comparison.points} points`}</span>
              </p>
              <p className="text-xs text-light-accent/50">
                {comparison.direction === 'same' ? 'The model estimates about the same risk.' : `The model estimates a ${comparison.direction} risk in this scenario.`}
              </p>
            </div>
          </div>
          <p className="compare-note">
            If your academic evidence looked like this scenario, the model would estimate a {formatPercent(scenarioPrediction.risk_probability)} risk
            instead of {formatPercent(prediction.risk_probability)}. This is a model estimate for a hypothetical situation, not a promise about what will happen.
          </p>
        </section>
      )}

      {usable && scenarioPrediction && (
        <section className="hypothetical-card p-5 space-y-3" aria-label="Hypothetical scenario prediction">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display font-semibold text-light-accent">Hypothetical scenario prediction</h2>
            <StatusBadge status="warning">Hypothetical</StatusBadge>
          </div>
          <p className="text-sm text-light-accent/65">Estimated from your saved what-if changes on course day {scenarioPrediction.based_on_day}. Your actual prediction and academic records are unchanged.</p>
          <div className="evidence-grid">
            <div className="evidence-cell"><p>Risk level</p><p>{scenarioPrediction.risk_level}</p></div>
            <div className="evidence-cell"><p>Probability</p><p>{formatPercent(scenarioPrediction.risk_probability)}</p></div>
            <div className="evidence-cell"><p>At risk</p><p>{scenarioPrediction.at_risk ? 'Yes' : 'No'}</p></div>
          </div>
          {(scenarioPrediction.explanation || []).length > 0 && (
            <ul className="space-y-2">{scenarioPrediction.explanation.map((item, index) => <li key={index} className="rounded-xl border border-border bg-surface/70 px-4 py-3 text-sm text-light-accent/75">{item}</li>)}</ul>
          )}
        </section>
      )}

      {usable && (
        <section className="glass rounded-2xl p-5 space-y-3" aria-label="Learning plan">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display font-semibold text-light-accent">{scenario.plan ? 'Your learning plan' : 'Keep this as a plan'}</h2>
            {scenario.plan && <StatusBadge status="success">Adopted</StatusBadge>}
          </div>
          <p className="text-sm text-light-accent/65">
            A scenario is never written into your academic records. {scenario.plan
              ? 'These targets are yours to work towards; your real grades, activity and actual prediction are unchanged.'
              : 'You can keep it as personal targets instead. Nothing about your real records or actual prediction changes.'}
          </p>
          {steps.length > 0 ? (
            <ol className="space-y-1 text-sm text-light-accent/80 list-decimal pl-5">{steps.map((step) => <li key={step}>{step}</li>)}</ol>
          ) : (
            <p className="text-sm text-light-accent/60">This scenario has no forward-looking targets.</p>
          )}
          <div className="scenario-actions">
            <button type="button" className="button-outline" onClick={onTogglePlan} disabled={busy}>
              {scenario.plan ? <><FlagOff size={14} aria-hidden="true" />Remove learning plan</> : <><Flag size={14} aria-hidden="true" />Use as my learning plan</>}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
