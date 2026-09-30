// Pure helpers that translate between what a student sees ("study a little
// more", "submit on time") and the what-if payload the gateway validates.
// The model semantics are unchanged: extra interactions are added on top of
// real activity and spread over the most recent course days; a latest score or
// timing replaces the most recent submitted assessment of that type; a new
// submission fills in an assessment that is overdue and still unsubmitted.

export const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const elapsedDays = (row) => Math.max(1, toNumber(row?.current_day, 0) + 1);

// Per activity type; mirrors the gateway's (day + 1) * 50 limit.
export const maxExtraClicks = (row) => elapsedDays(row) * 50;

export const ASSESSMENT_TYPES = ['tma', 'cma'];
export const ASSESSMENT_NAMES = { tma: 'assignment (TMA)', cma: 'computer-marked test (CMA)' };
export const ACTIVITY_NAMES = { quiz_clicks: 'quizzes', forum_clicks: 'forums', resource_clicks: 'study materials' };

export const ACTIVITY_PRESETS = [
  { id: 'none', label: 'No change', ratio: 0, days: 1, hint: 'Keep your activity as it is.' },
  { id: 'little', label: 'A little more', ratio: 0.25, days: 7, hint: 'About a quarter more than now, over the last week.' },
  { id: 'moderate', label: 'Moderately more', ratio: 0.5, days: 14, hint: 'About half as much again, over the last two weeks.' },
  { id: 'much', label: 'Much more', ratio: 1, days: 21, hint: 'About double, over the last three weeks.' },
  { id: 'custom', label: 'Custom', hint: 'Set exact numbers yourself.' },
];

export const TIMING_PRESETS = [
  { id: 'on_time', label: 'On time', delay: 0 },
  { id: 'late_2', label: '1–2 days late', delay: 2 },
  { id: 'late_5', label: '3–5 days late', delay: 5 },
  { id: 'custom', label: 'Custom' },
];

const activityMix = (row) => {
  const quiz = toNumber(row?.quiz_clicks);
  const forum = toNumber(row?.forumng_clicks);
  const resource = toNumber(row?.resource_clicks);
  const total = quiz + forum + resource;
  if (total <= 0) return { quiz: 0.3, forum: 0.3, resource: 0.4 };
  return { quiz: quiz / total, forum: forum / total, resource: resource / total };
};

const emptyActivity = () => ({ quiz_clicks: 0, forum_clicks: 0, resource_clicks: 0, activity_days: 1 });

// A preset scales the student's own activity so "a little more" means the
// same thing for a quiet student and a very active one, and keeps their mix.
export const activityFromPreset = (row, presetId) => {
  const preset = ACTIVITY_PRESETS.find((item) => item.id === presetId);
  if (!preset || !preset.ratio) return emptyActivity();
  const cap = maxExtraClicks(row);
  const base = Math.max(toNumber(row?.total_clicks), 40);
  const total = Math.round(base * preset.ratio);
  const mix = activityMix(row);
  const quiz = Math.round(total * mix.quiz);
  const forum = Math.round(total * mix.forum);
  const resource = total - quiz - forum;
  return {
    quiz_clicks: clamp(quiz, 0, cap), forum_clicks: clamp(forum, 0, cap), resource_clicks: clamp(resource, 0, cap),
    activity_days: Math.min(preset.days, elapsedDays(row)),
  };
};

export const totalExtraClicks = (activity) => toNumber(activity?.quiz_clicks) + toNumber(activity?.forum_clicks) + toNumber(activity?.resource_clicks);

export const presetForActivity = (row, activity) => {
  if (totalExtraClicks(activity) === 0) return 'none';
  const match = ACTIVITY_PRESETS.find((preset) => {
    if (!preset.ratio) return false;
    const expected = activityFromPreset(row, preset.id);
    return ['quiz_clicks', 'forum_clicks', 'resource_clicks', 'activity_days'].every((key) => expected[key] === toNumber(activity?.[key]));
  });
  return match ? match.id : 'custom';
};

export const timingForDelay = (delay) => {
  if (delay === undefined || delay === null || delay === '') return 'keep';
  const match = TIMING_PRESETS.find((preset) => preset.delay === Number(delay));
  return match ? match.id : 'custom';
};

export const delayForTiming = (timing, customDelay) => {
  if (timing === 'keep') return undefined;
  if (timing === 'custom') return toNumber(customDelay, 0);
  return TIMING_PRESETS.find((preset) => preset.id === timing)?.delay ?? 0;
};

export const latestAssessment = (row, type) => {
  if (!row?.[`latest_${type}_id`]) return null;
  const due = row[`latest_${type}_due_date`];
  const submitted = row[`latest_${type}_date_submitted`];
  const currentDay = toNumber(row.current_day);
  return {
    type,
    score: toNumber(row[`latest_${type}_score`]),
    due: due == null ? null : Number(due),
    submitted: submitted == null ? null : Number(submitted),
    lateDays: due == null || submitted == null ? null : Number(submitted) - Number(due),
    maxDelay: due == null ? 0 : Math.max(0, currentDay - Number(due)),
  };
};

// An assessment the student can still "submit" in a scenario: it is due by
// the current course day and has no submission.
export const missingAssessment = (row, type) => {
  const key = type.toLowerCase();
  if (!row?.[`next_${key}_assessment_id`] || row[`next_${key}_due_date`] == null) return null;
  const due = Number(row[`next_${key}_due_date`]);
  const currentDay = toNumber(row.current_day);
  if (due > currentDay) return null;
  return { type: key, due, maxDelay: currentDay - due };
};

export const missingAssessmentTypes = (row) => ['TMA', 'CMA'].filter((type) => missingAssessment(row, type));

export const describeLateness = (lateDays) => {
  if (lateDays === null || lateDays === undefined) return 'timing unknown';
  if (lateDays === 0) return 'on time';
  if (lateDays < 0) return `${-lateDays} day${lateDays === -1 ? '' : 's'} early`;
  return `${lateDays} day${lateDays === 1 ? '' : 's'} late`;
};

const assessmentDefaults = (row, type) => {
  const latest = latestAssessment(row, type);
  return { scoreMode: 'keep', score: latest ? latest.score : 60, timing: 'keep', delay: 0 };
};

export const defaultForm = (row) => ({
  activityPreset: 'none',
  ...emptyActivity(),
  tma: assessmentDefaults(row, 'tma'),
  cma: assessmentDefaults(row, 'cma'),
  submission: { enabled: false, type: missingAssessmentTypes(row)[0] || 'TMA', score: 60, timing: 'on_time', delay: 0 },
});

// Rebuild the controls from a saved scenario so the student sees what they
// saved and can adjust it.
export const formFromInputs = (row, inputs = {}) => {
  const form = defaultForm(row);
  const activity = {
    quiz_clicks: toNumber(inputs.quiz_clicks), forum_clicks: toNumber(inputs.forum_clicks),
    resource_clicks: toNumber(inputs.resource_clicks), activity_days: toNumber(inputs.activity_days, 1) || 1,
  };
  Object.assign(form, activity, { activityPreset: presetForActivity(row, activity) });
  for (const type of ASSESSMENT_TYPES) {
    const score = inputs[`latest_${type}_score`];
    const delay = inputs[`${type}_delay_days`];
    if (score !== undefined && score !== null) form[type] = { ...form[type], scoreMode: 'change', score: toNumber(score) };
    if (delay !== undefined && delay !== null) form[type] = { ...form[type], timing: timingForDelay(delay), delay: toNumber(delay) };
  }
  if (inputs.new_submission_score !== undefined && inputs.new_submission_score !== null) {
    const delay = inputs.new_submission_delay_days ?? 0;
    form.submission = { enabled: true, type: inputs.new_submission_type || 'TMA', score: toNumber(inputs.new_submission_score),
      timing: timingForDelay(delay), delay: toNumber(delay) };
  }
  return form;
};

export const buildPayload = (form, row) => {
  const payload = {
    quiz_clicks: toNumber(form.quiz_clicks), forum_clicks: toNumber(form.forum_clicks),
    resource_clicks: toNumber(form.resource_clicks), activity_days: Math.max(1, toNumber(form.activity_days, 1)),
  };
  for (const type of ASSESSMENT_TYPES) {
    if (!latestAssessment(row, type)) continue;
    const control = form[type] || {};
    if (control.scoreMode === 'change') payload[`latest_${type}_score`] = clamp(toNumber(control.score), 0, 100);
    const delay = delayForTiming(control.timing, control.delay);
    if (delay !== undefined) payload[`${type}_delay_days`] = delay;
  }
  const submission = form.submission || {};
  if (submission.enabled && missingAssessment(row, submission.type || 'TMA')) {
    payload.new_submission_type = submission.type || 'TMA';
    payload.new_submission_score = clamp(toNumber(submission.score), 0, 100);
    payload.new_submission_delay_days = delayForTiming(submission.timing === 'keep' ? 'on_time' : submission.timing, submission.delay);
  }
  return payload;
};

export const hasChanges = (payload) => Object.keys(payload).some((key) => {
  if (key === 'activity_days') return false;
  if (['quiz_clicks', 'forum_clicks', 'resource_clicks'].includes(key)) return payload[key] > 0;
  return payload[key] !== undefined;
});

const list = (parts) => parts.filter(Boolean).join(' · ');

// Short sentences for the summary strip. Every sentence names the current
// value and the scenario value where there is one.
export const describeChanges = (payload, row) => {
  const changes = [];
  const extra = totalExtraClicks(payload);
  if (extra > 0) {
    const breakdown = list(['quiz_clicks', 'forum_clicks', 'resource_clicks'].map((key) => payload[key] > 0 ? `${ACTIVITY_NAMES[key]} +${payload[key]}` : ''));
    const days = payload.activity_days || 1;
    changes.push(`+${extra} interactions over the last ${days} day${days === 1 ? '' : 's'} (${breakdown}); now ${toNumber(row?.total_clicks)} in total.`);
  }
  for (const type of ASSESSMENT_TYPES) {
    const latest = latestAssessment(row, type);
    if (!latest) continue;
    const label = type.toUpperCase();
    const score = payload[`latest_${type}_score`];
    if (score !== undefined) changes.push(`Latest ${label} score ${latest.score} → ${score}.`);
    const delay = payload[`${type}_delay_days`];
    if (delay !== undefined) changes.push(`Latest ${label} submitted ${describeLateness(latest.lateDays)} → ${describeLateness(delay)}.`);
  }
  if (payload.new_submission_score !== undefined) {
    const type = payload.new_submission_type || 'TMA';
    const missing = missingAssessment(row, type);
    changes.push(`Missed ${type}${missing ? ` (due day ${missing.due})` : ''}: unsubmitted → submitted ${describeLateness(payload.new_submission_delay_days ?? 0)} with a score of ${payload.new_submission_score}.`);
  }
  return changes;
};

// Forward-looking targets derived from a saved scenario; nothing here writes
// to academic records.
export const planSteps = (inputs = {}, row) => {
  const steps = [];
  const extra = totalExtraClicks(inputs);
  if (extra > 0) {
    const days = toNumber(inputs.activity_days, 1) || 1;
    const perDay = Math.max(1, Math.round(extra / days));
    const breakdown = list(['quiz_clicks', 'forum_clicks', 'resource_clicks'].map((key) => inputs[key] > 0 ? `${ACTIVITY_NAMES[key]} ${inputs[key]}` : ''));
    steps.push(`Add about ${extra} interactions over the next ${days} day${days === 1 ? '' : 's'}, roughly ${perDay} a day (${breakdown}).`);
  }
  for (const type of ASSESSMENT_TYPES) {
    const label = type.toUpperCase();
    const score = inputs[`latest_${type}_score`];
    const latest = latestAssessment(row, type);
    if (score !== undefined && score !== null && (!latest || score > latest.score)) steps.push(`Aim for ${score} or more on your next ${label}.`);
    const delay = inputs[`${type}_delay_days`];
    if (delay !== undefined && delay !== null) steps.push(delay === 0 ? `Submit your next ${label} on time.` : `Submit your next ${label} within ${delay} day${delay === 1 ? '' : 's'} of the due date.`);
  }
  if (inputs.new_submission_score !== undefined && inputs.new_submission_score !== null) {
    const type = inputs.new_submission_type || 'TMA';
    steps.push(`Submit the missed ${type} as soon as you can, aiming for ${inputs.new_submission_score}.`);
  }
  return steps;
};

export const formatPercent = (probability) => `${(toNumber(probability) * 100).toFixed(1)}%`;

export const compareRisk = (actual, scenario) => {
  if (actual == null || scenario == null) return null;
  const points = Math.round((toNumber(scenario) - toNumber(actual)) * 1000) / 10;
  const direction = Math.abs(points) < 0.05 ? 'same' : points < 0 ? 'lower' : 'higher';
  return { points: Math.abs(points), direction };
};
