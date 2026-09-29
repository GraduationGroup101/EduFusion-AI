import { useId } from 'react';
import { BookOpen, ClipboardList, MousePointerClick } from 'lucide-react';
import {
  ACTIVITY_NAMES, ACTIVITY_PRESETS, ASSESSMENT_NAMES, ASSESSMENT_TYPES, TIMING_PRESETS,
  activityFromPreset, buildPayload, clamp, describeChanges, describeLateness, elapsedDays,
  latestAssessment, maxExtraClicks, missingAssessment, missingAssessmentTypes, toNumber, totalExtraClicks,
} from '../../lib/scenario';

const Segmented = ({ name, legend, options, value, onChange, disabled }) => (
  <fieldset className="segmented" disabled={disabled}>
    <legend>{legend}</legend>
    <div className="segmented-options">
      {options.map((option) => (
        <label key={option.id} title={option.title}>
          <input type="radio" name={name} value={option.id} checked={value === option.id} disabled={option.disabled}
            onChange={() => onChange(option.id)} />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  </fieldset>
);

const NumberField = ({ label, value, onChange, min = 0, max, hint, disabled }) => (
  <label className="field-label">
    <span>{label}</span>
    <input type="number" inputMode="numeric" min={min} max={max} value={value ?? ''} disabled={disabled}
      onChange={(event) => {
        const next = event.target.value;
        if (next === '') { onChange(''); return; }
        const parsed = Math.trunc(Number(next));
        if (Number.isFinite(parsed)) onChange(clamp(parsed, min, max));
      }} />
    {hint && <small>{hint}</small>}
  </label>
);

const ScoreControl = ({ label, value, onChange, current, disabled }) => {
  const id = useId();
  const score = clamp(toNumber(value), 0, 100);
  return (
    <div className="score-control">
      <div className="score-control-head">
        <label htmlFor={`${id}-range`}>{label}</label>
        {current !== null && current !== undefined && <span>Now: {current}</span>}
      </div>
      <input id={`${id}-range`} type="range" min={0} max={100} step={1} value={score} disabled={disabled}
        aria-valuetext={`${score} out of 100`} onChange={(event) => onChange(Number(event.target.value))} />
      <input aria-label={`${label} (exact value)`} type="number" inputMode="numeric" min={0} max={100} value={score} disabled={disabled}
        onChange={(event) => {
          const parsed = Math.trunc(Number(event.target.value));
          if (Number.isFinite(parsed)) onChange(clamp(parsed, 0, 100));
        }} />
    </div>
  );
};

const Section = ({ icon: Icon, step, title, intro, now, children }) => {
  const id = useId();
  return (
    <section className="scenario-section" aria-labelledby={id}>
      <header>
        <span className="scenario-step" aria-hidden="true">{Icon ? <Icon size={16} /> : step}</span>
        <div>
          <h3 id={id}>{title}</h3>
          <p>{intro}</p>
          {now && <p className="scenario-now">{now}</p>}
        </div>
      </header>
      <div className="scenario-section-body space-y-4">{children}</div>
    </section>
  );
};

const timingOptions = (maxDelay, includeKeep) => [
  ...(includeKeep ? [{ id: 'keep', label: 'Keep current' }] : []),
  ...TIMING_PRESETS.map((preset) => ({
    id: preset.id, label: preset.label,
    disabled: preset.delay !== undefined && preset.delay > maxDelay,
    title: preset.delay !== undefined && preset.delay > maxDelay ? `Not possible: the due date was ${maxDelay} day${maxDelay === 1 ? '' : 's'} ago` : undefined,
  })),
];

const describeActivityNow = (row) => {
  const since = row.days_since_last_click;
  const lastActive = since === null || since === undefined ? '' : `, last active ${Number(since) === 0 ? 'today' : `${since} day${Number(since) === 1 ? '' : 's'} ago`}`;
  return `Now: ${toNumber(row.total_clicks)} interactions on ${toNumber(row.active_days)} active day${toNumber(row.active_days) === 1 ? '' : 's'}${lastActive}.`;
};

export default function ScenarioBuilder({ row, form, onChange, disabled = false }) {
  const currentDay = toNumber(row?.current_day);
  const activity = { quiz_clicks: form.quiz_clicks, forum_clicks: form.forum_clicks, resource_clicks: form.resource_clicks, activity_days: form.activity_days };
  const extra = totalExtraClicks(activity);
  const payload = buildPayload(form, row);
  const changes = describeChanges(payload, row);
  const missing = missingAssessmentTypes(row);
  const chosenType = missing.includes(form.submission?.type) ? form.submission.type : missing[0];
  const missingInfo = chosenType ? missingAssessment(row, chosenType) : null;

  const setPreset = (id) => {
    // Custom starts from something sensible instead of zeros.
    const values = id === 'custom' ? (extra > 0 ? activity : activityFromPreset(row, 'little')) : activityFromPreset(row, id);
    onChange({ ...form, activityPreset: id, ...values });
  };
  const setActivity = (key, value) => onChange({ ...form, activityPreset: 'custom', [key]: value });
  const setAssessment = (type, patch) => onChange({ ...form, [type]: { ...form[type], ...patch } });
  const setSubmission = (patch) => onChange({ ...form, submission: { ...form.submission, ...patch } });

  return (
    <div className="space-y-4">
      <Section icon={MousePointerClick} step={1} title="Study activity"
        intro="Extra time on quizzes, forums and study materials, added on top of what you have already done."
        now={describeActivityNow(row)}>
        <Segmented name="activity-preset" legend="How much more would you study?" disabled={disabled} value={form.activityPreset} onChange={setPreset}
          options={ACTIVITY_PRESETS.map((preset) => ({ id: preset.id, label: preset.label, title: preset.hint }))} />
        {form.activityPreset !== 'none' && (
          <p className="scenario-now" aria-live="polite">
            Scenario: <strong>+{extra} interactions</strong> spread over the last {activity.activity_days} day{activity.activity_days === 1 ? '' : 's'}
            {extra > 0 && ` (${['quiz_clicks', 'forum_clicks', 'resource_clicks'].filter((key) => activity[key] > 0).map((key) => `${ACTIVITY_NAMES[key]} +${activity[key]}`).join(' · ')})`}.
          </p>
        )}
        {form.activityPreset === 'custom' && (
          <div className="scenario-fields">
            <NumberField label="Extra quiz interactions" value={form.quiz_clicks} max={maxExtraClicks(row)} disabled={disabled} hint={`Up to ${maxExtraClicks(row).toLocaleString()}`} onChange={(value) => setActivity('quiz_clicks', value)} />
            <NumberField label="Extra forum interactions" value={form.forum_clicks} max={maxExtraClicks(row)} disabled={disabled} hint={`Up to ${maxExtraClicks(row).toLocaleString()}`} onChange={(value) => setActivity('forum_clicks', value)} />
            <NumberField label="Extra study material interactions" value={form.resource_clicks} max={maxExtraClicks(row)} disabled={disabled} hint={`Up to ${maxExtraClicks(row).toLocaleString()}`} onChange={(value) => setActivity('resource_clicks', value)} />
            <NumberField label="Spread over the last (days)" value={form.activity_days} min={1} max={elapsedDays(row)} disabled={disabled} hint={`Up to ${elapsedDays(row)} days so far`} onChange={(value) => setActivity('activity_days', value === '' ? '' : value)} />
          </div>
        )}
      </Section>

      {ASSESSMENT_TYPES.some((type) => latestAssessment(row, type)) && (
        <Section icon={BookOpen} step={2} title="Latest graded work"
          intro="Try a different score or a different submission time for the most recent work you have handed in. This changes only the scenario.">
          {ASSESSMENT_TYPES.map((type) => {
            const latest = latestAssessment(row, type);
            if (!latest) return null;
            const label = type.toUpperCase();
            const control = form[type];
            return (
              <div key={type} className="scenario-subcard">
                <h4>{ASSESSMENT_NAMES[type][0].toUpperCase() + ASSESSMENT_NAMES[type].slice(1)}</h4>
                <p className="scenario-now">
                  Now: scored <strong>{latest.score}</strong> out of 100, submitted <strong>{describeLateness(latest.lateDays)}</strong>
                  {latest.submitted !== null && latest.due !== null ? ` (day ${latest.submitted}, due day ${latest.due})` : ''}.
                </p>
                <Segmented name={`${type}-score`} legend="Score" disabled={disabled} value={control.scoreMode}
                  options={[{ id: 'keep', label: `Keep ${latest.score}` }, { id: 'change', label: 'Try a different score' }]}
                  onChange={(scoreMode) => setAssessment(type, { scoreMode })} />
                {control.scoreMode === 'change' && (
                  <ScoreControl label={`Scenario ${label} score`} value={control.score} current={latest.score} disabled={disabled} onChange={(score) => setAssessment(type, { score })} />
                )}
                <Segmented name={`${type}-timing`} legend="Submission timing" disabled={disabled} value={control.timing}
                  options={timingOptions(latest.maxDelay, true)}
                  onChange={(timing) => setAssessment(type, { timing, delay: clamp(toNumber(control.delay), 0, latest.maxDelay) })} />
                {control.timing === 'custom' && (
                  <NumberField label={`${label} days after the due date`} value={control.delay} min={0} max={latest.maxDelay} disabled={disabled}
                    hint={`0 means on the due day. Up to ${latest.maxDelay} by day ${currentDay}.`} onChange={(delay) => setAssessment(type, { delay })} />
                )}
              </div>
            );
          })}
        </Section>
      )}

      <Section icon={ClipboardList} step={3} title="Missed assessment"
        intro={missing.length
          ? 'Something was due and has not been handed in. See what the model would estimate if it had been submitted.'
          : 'This option appears when an assessment is due and still unsubmitted.'}
        now={missingInfo ? `Now: ${chosenType} due on day ${missingInfo.due}, not submitted.` : 'No missed assessments right now. Future submissions become available as the course clock advances.'}>
        {missingInfo && (
          <>
            <Segmented name="submission" legend="Submission" disabled={disabled} value={form.submission.enabled ? 'add' : 'skip'}
              options={[{ id: 'skip', label: 'Leave it unsubmitted' }, { id: 'add', label: 'Add a submission' }]}
              onChange={(value) => setSubmission({ enabled: value === 'add', type: chosenType })} />
            {form.submission.enabled && (
              <>
                {missing.length > 1 && (
                  <label className="field-label">
                    <span>Which assessment</span>
                    <select value={chosenType} disabled={disabled} onChange={(event) => setSubmission({ type: event.target.value, delay: 0, timing: 'on_time' })}>
                      {missing.map((type) => <option key={type} value={type}>{type} (due day {missingAssessment(row, type).due})</option>)}
                    </select>
                  </label>
                )}
                <ScoreControl label={`Scenario ${chosenType} score`} value={form.submission.score} disabled={disabled} onChange={(score) => setSubmission({ score })} />
                <Segmented name="submission-timing" legend="Submission timing" disabled={disabled} value={form.submission.timing}
                  options={timingOptions(missingInfo.maxDelay, false)}
                  onChange={(timing) => setSubmission({ timing, delay: clamp(toNumber(form.submission.delay), 0, missingInfo.maxDelay) })} />
                {form.submission.timing === 'custom' && (
                  <NumberField label={`${chosenType} days after the due date`} value={form.submission.delay} min={0} max={missingInfo.maxDelay} disabled={disabled}
                    hint={`0 means on the due day. Up to ${missingInfo.maxDelay} by day ${currentDay}.`} onChange={(delay) => setSubmission({ delay })} />
                )}
              </>
            )}
          </>
        )}
      </Section>

      <div className="scenario-summary" aria-live="polite">
        <strong>Your scenario</strong>
        {changes.length ? (
          <ul>{changes.map((change) => <li key={change}>{change}</li>)}</ul>
        ) : (
          <p className="mt-1 text-light-accent/60">No changes yet. Pick an option above to build your scenario.</p>
        )}
      </div>
    </div>
  );
}
