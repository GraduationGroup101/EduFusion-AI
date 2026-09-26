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
    const data = { inputs: values, activity: additions, projected, based_on_day: day, prediction: null,
      prediction_available: false, message: 'Scenario saved separately. Hypothetical risk requires a prediction service that accepts scenario features.' };
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

module.exports = { distributeClicks, saveScenario, getScenario };
