const { transaction, readQuery } = require('./index');
const { getStudentBehaviorData } = require('./queries');
const { scenario: validateScenario, integer, badRequest } = require('../lib/validation');

const distributeClicks = (amount, days, currentDay) => {
  const result = [];
  const quotient = Math.floor(amount / days);
  const remainder = amount % days;
  for (let index = 0; index < days; index += 1) {
    const clicks = quotient + (index < remainder ? 1 : 0);
    if (clicks) result.push({ date: currentDay - index, clicks });
  }
  return result;
};

// The evidence a scenario was built on. Stored with the scenario so a later
// read can tell whether the real records moved underneath it.
const EVIDENCE_KEYS = [
  'total_clicks', 'quiz_clicks', 'forumng_clicks', 'resource_clicks', 'active_days', 'num_submitted',
  'latest_tma_id', 'latest_tma_score', 'latest_tma_date_submitted', 'latest_tma_due_date',
  'latest_cma_id', 'latest_cma_score', 'latest_cma_date_submitted', 'latest_cma_due_date',
  'next_tma_assessment_id', 'next_tma_due_date', 'next_cma_assessment_id', 'next_cma_due_date',
];
const numberOrNull = (value) => (value === null || value === undefined ? null : Number(value));
const snapshotEvidence = (row) => Object.fromEntries(EVIDENCE_KEYS.map((key) => [key, numberOrNull(row[key])]));

// Classify a saved scenario against the enrollment's current evidence.
//   current             - same course day, same evidence, every reference still applies
//   needs_reevaluation  - same day, but real activity or grades changed since it was saved
//   stale               - the course day moved; the model must not reuse the old day
//   invalid             - something it references (an assessment, a delay window) no longer applies
const scenarioStatus = (saved, course) => {
  const data = saved?.data;
  if (!data || !course) return null;
  const currentDay = Number(course.current_day);
  const basedOn = Number(data.based_on_day);
  const inputs = data.inputs || {};
  const evidence = data.evidence || null;
  const reasons = [];
  for (const type of ['tma', 'cma']) {
    const label = type.toUpperCase();
    const score = inputs[`latest_${type}_score`];
    const delay = inputs[`${type}_delay_days`];
    if (score === undefined && delay === undefined) continue;
    const id = numberOrNull(course[`latest_${type}_id`]);
    if (id === null) reasons.push(`The submitted ${label} this scenario changes is no longer available.`);
    else if (evidence && evidence[`latest_${type}_id`] !== null && evidence[`latest_${type}_id`] !== id) reasons.push(`A newer ${label} was submitted after this scenario was saved.`);
    else if (delay !== undefined) {
      const due = numberOrNull(course[`latest_${type}_due_date`]);
      if (due === null || due + delay > currentDay) reasons.push(`The ${label} timing in this scenario is not possible on day ${currentDay}.`);
    }
  }
  if (inputs.new_submission_score !== undefined) {
    const type = (inputs.new_submission_type || 'TMA').toLowerCase();
    const label = type.toUpperCase();
    const id = numberOrNull(course[`next_${type}_assessment_id`]);
    const due = numberOrNull(course[`next_${type}_due_date`]);
    if (id === null) reasons.push(`The unsubmitted ${label} in this scenario has since been submitted or removed.`);
    else if (evidence && evidence[`next_${type}_assessment_id`] !== null && evidence[`next_${type}_assessment_id`] !== id) reasons.push(`The unsubmitted ${label} in this scenario has since been submitted.`);
    else if (due === null || due + (inputs.new_submission_delay_days ?? 0) > currentDay) reasons.push(`The ${label} submission in this scenario would happen after day ${currentDay}.`);
  }
  if ((inputs.activity_days ?? 1) > currentDay + 1) reasons.push('The activity in this scenario is spread over more days than the course has reached.');
  const base = { based_on_day: basedOn, current_day: currentDay, saved_at: saved.updated_at || null };
  if (reasons.length) return { ...base, state: 'invalid', reasons };
  if (basedOn !== currentDay) {
    return { ...base, state: 'stale', reasons: [`This scenario was built on course day ${basedOn}. The course is now on day ${currentDay}.`] };
  }
  if (evidence) {
    const changed = EVIDENCE_KEYS.filter((key) => numberOrNull(course[key]) !== evidence[key]);
    if (changed.length) {
      return { ...base, state: 'needs_reevaluation', changed,
        reasons: ['Your academic records changed since this scenario was saved, so its summary may be out of date.'] };
    }
  }
  return { ...base, state: 'current', reasons: [] };
};

const saveScenario = async (idStudent, enrollmentId, input) => {
  const values = validateScenario(input);
  const id = integer(enrollmentId, 'Enrollment ID', 1);
  const rows = await getStudentBehaviorData(idStudent);
  const base = rows.find((row) => Number(row.enrollment_id) === id);
  if (!base) return null;
  const day = Number(base.current_day);
  const days = values.activity_days ?? 1;
  if (days > day + 1) throw badRequest('Activity days cannot exceed elapsed course days');
  const additions = {};
  for (const field of ['quiz_clicks', 'forum_clicks', 'resource_clicks']) {
    const amount = values[field] ?? 0;
    if (amount > (day + 1) * 50) throw badRequest(`${field} exceeds the course activity limit`);
    additions[field] = distributeClicks(amount, days, day);
  }
  for (const type of ['tma', 'cma']) {
    if (values[`latest_${type}_score`] !== undefined && !base[`latest_${type}_id`]) throw badRequest(`No submitted ${type.toUpperCase()} assessment exists`);
    if (values[`${type}_delay_days`] !== undefined) {
      const due = base[`latest_${type}_due_date`];
      if (!base[`latest_${type}_id`] || due == null || values[`${type}_delay_days`] > day - Number(due)) throw badRequest(`Invalid ${type.toUpperCase()} delay`);
    }
  }
  if (values.new_submission_score !== undefined) {
    const type = (values.new_submission_type || 'TMA').toLowerCase();
    if (!base[`next_${type}_assessment_id`]) throw badRequest(`No unsubmitted ${type.toUpperCase()} assessment exists`);
    const due = Number(base[`next_${type}_due_date`] ?? day);
    if (due + (values.new_submission_delay_days ?? 0) > day) throw badRequest('A simulated submission cannot occur after the current course day');
  }
  const projected = {
    total_clicks: Number(base.total_clicks) + ['quiz_clicks', 'forum_clicks', 'resource_clicks'].reduce((sum, key) => sum + (values[key] || 0), 0),
    quiz_clicks: Number(base.quiz_clicks) + (values.quiz_clicks || 0),
    forumng_clicks: Number(base.forumng_clicks) + (values.forum_clicks || 0),
    resource_clicks: Number(base.resource_clicks) + (values.resource_clicks || 0),
    latest_tma_score: values.latest_tma_score ?? base.latest_tma_score,
    latest_cma_score: values.latest_cma_score ?? base.latest_cma_score,
  };
  if (values.new_submission_score !== undefined) {
    const type = (values.new_submission_type || 'TMA').toLowerCase();
    projected[`latest_${type}_score`] = values.new_submission_score;
  }
  projected.num_submitted = Number(base.num_submitted) + (values.new_submission_score !== undefined ? 1 : 0);
  return transaction(async (client) => {
    // Recheck ownership and course day at the write boundary. Only the isolated
    // scenario table changes; original academic evidence is never edited.
    const enrollment = await client.query(
      `SELECT e.id FROM enrollments e JOIN academic_clocks ac ON ac.course_presentation_id=e.course_presentation_id
       WHERE e.id=$1 AND e.id_student=$2 AND ac.current_day=$3 FOR SHARE OF e, ac`, [id, idStudent, day]
    );
    if (!enrollment.rowCount) throw Object.assign(new Error('Course data changed. Reload and try again.'), { statusCode: 409 });
    const data = { inputs: values, activity: additions, projected, based_on_day: day, evidence: snapshotEvidence(base), plan: null, prediction: null,
      prediction_available: false, message: 'Scenario saved separately from academic records. Its hypothetical risk is evaluated independently.' };
    await client.query(
      `INSERT INTO edufusion_student_scenarios (id_student,enrollment_id,data) VALUES ($1,$2,$3)
       ON CONFLICT(id_student,enrollment_id) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()`, [idStudent, id, JSON.stringify(data)]
    );
    return data;
  });
};

const getScenario = async (idStudent, enrollmentId) => {
  const result = await readQuery('SELECT data,updated_at FROM edufusion_student_scenarios WHERE id_student=$1 AND enrollment_id=$2', [idStudent, enrollmentId]);
  return result.rows[0] || null;
};

// Removes only the isolated what-if row. Academic evidence and the actual
// prediction history are never touched, and the owner filter is part of the
// statement so another student's row can never match.
const deleteScenario = async (idStudent, enrollmentId) => {
  const id = integer(enrollmentId, 'Enrollment ID', 1);
  const result = await transaction((client) => client.query(
    'DELETE FROM edufusion_student_scenarios WHERE id_student=$1 AND enrollment_id=$2', [idStudent, id]
  ));
  return result.rowCount > 0;
};

// A learning plan is a label on the saved scenario: "this is what I intend to
// do". It is the non-destructive alternative to writing scenario values into
// real records.
const setScenarioPlan = async (idStudent, enrollmentId, adopted) => {
  const id = integer(enrollmentId, 'Enrollment ID', 1);
  return transaction(async (client) => {
    const current = await client.query(
      'SELECT data FROM edufusion_student_scenarios WHERE id_student=$1 AND enrollment_id=$2 FOR UPDATE', [idStudent, id]
    );
    if (!current.rowCount) return null;
    const data = { ...current.rows[0].data, plan: adopted ? { adopted_at: new Date().toISOString() } : null };
    await client.query(
      'UPDATE edufusion_student_scenarios SET data=$3 WHERE id_student=$1 AND enrollment_id=$2', [idStudent, id, JSON.stringify(data)]
    );
    return data;
  });
};

module.exports = { distributeClicks, EVIDENCE_KEYS, snapshotEvidence, scenarioStatus, saveScenario, getScenario, deleteScenario, setScenarioPlan };
