const { readQuery, transaction } = require('./index');
const bcrypt = require('bcryptjs');
const { badRequest, integer, registration } = require('../lib/validation');

const findUserByUsername = async (username) => {
  const result = await readQuery('SELECT id, username, password_hash, role, is_active FROM app_users WHERE username = $1',
    [username]
  );
  return result.rows[0] || null;
};

const findStudentById = async (idStudent) => {
  const result = await readQuery('SELECT id_student, student_name, pin_hash, pin_format FROM students WHERE id_student = $1',
    [idStudent]
  );
  return result.rows[0] || null;
};

const listRegisterableCoursePresentations = async () => {
  const result = await readQuery(`SELECT
       cp.id,
       cp.code_module,
       cp.code_presentation,
       cp.module_presentation_length,
       ac.current_day,
       COUNT(a.id_assessment)::int AS assessment_count,
       COUNT(a.id_assessment) FILTER (WHERE a.assessment_type IN ('TMA', 'CMA', 'Quiz', 'Assignment'))::int AS coursework_count
     FROM course_presentations cp
     JOIN academic_clocks ac ON ac.course_presentation_id = cp.id
     LEFT JOIN assessments a ON a.course_presentation_id = cp.id
     GROUP BY cp.id, cp.code_module, cp.code_presentation, cp.module_presentation_length, ac.current_day
     HAVING COUNT(a.id_assessment) > 0
     ORDER BY cp.code_module, cp.code_presentation`
  );
  return result.rows;
};

const registerStudentWithEnrollment = async (values) => {
  values = registration(values);
  const idStudent = integer(values.id_student, 'Student ID', 1);
  const coursePresentationId = integer(values.course_presentation_id, 'Course', 1);
  const pinHash = await bcrypt.hash(values.pin, 12);
  try {
    return await transaction(async (client) => {
      const existing = await client.query('SELECT id_student FROM students WHERE id_student = $1', [idStudent]);
      if (existing.rowCount) throw Object.assign(new Error('Student ID already exists. Please sign in instead.'), { statusCode: 409 });
      const course = await client.query(
        `SELECT cp.id, cp.code_module, cp.code_presentation
         FROM course_presentations cp
         JOIN academic_clocks ac ON ac.course_presentation_id = cp.id
         WHERE cp.id = $1 AND EXISTS (SELECT 1 FROM assessments a WHERE a.course_presentation_id = cp.id)`,
        [coursePresentationId]
      );
      if (!course.rows[0]) throw badRequest('Selected course is not available for registration');
      await client.query(
        "INSERT INTO students (id_student, student_name, email, pin_hash, pin_format) VALUES ($1, $2, $3, $4, 'bcrypt')",
        [idStudent, values.student_name, values.email || null, pinHash]
      );
      const enrollment = await client.query(
        `INSERT INTO enrollments (id_student, course_presentation_id, gender, region, highest_education,
          imd_band, age_band, num_of_prev_attempts, studied_credits, disability, final_result, date_registration, date_unregistration)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Registered',$11,NULL) RETURNING id AS enrollment_id`,
        [idStudent, coursePresentationId, values.gender, values.region, values.highest_education, values.imd_band,
         values.age_band, values.num_of_prev_attempts, values.studied_credits, values.disability, values.date_registration]
      );
      return { id_student: idStudent, enrollment_id: enrollment.rows[0].enrollment_id,
        code_module: course.rows[0].code_module, code_presentation: course.rows[0].code_presentation };
    });
  } catch (error) {
    if (error.code === '23505') throw Object.assign(new Error('Student ID already exists. Please sign in instead.'), { statusCode: 409 });
    throw error;
  }
};

const getUserById = async (id) => {
  const result = await readQuery('SELECT id, username, role, is_active, created_at FROM app_users WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
};

const getStudentUserById = async (idStudent) => {
  const result = await readQuery('SELECT id_student, student_name, created_at FROM students WHERE id_student = $1',
    [idStudent]
  );
  const student = result.rows[0];
  if (!student) return null;
  return {
    id: student.id_student,
    id_student: student.id_student,
    username: String(student.id_student),
    student_name: student.student_name,
    role: 'student',
    is_active: true,
    created_at: student.created_at,
  };
};

const getDashboardStats = async () => {
  const [students, enrollments, predictions, atRisk] = await Promise.all([
    readQuery('SELECT COUNT(*) FROM students'),
    readQuery('SELECT COUNT(*) FROM enrollments'),
    readQuery(`WITH current_predictions AS (
         SELECT DISTINCT ON (p.enrollment_id)
                p.enrollment_id, p.at_risk, p.created_at
         FROM predictions p
         JOIN enrollments e ON e.id = p.enrollment_id
         JOIN academic_clocks ac ON ac.course_presentation_id = e.course_presentation_id
         WHERE p.day_of_course = ac.current_day
         ORDER BY p.enrollment_id, p.created_at DESC
       )
       SELECT COUNT(*) FROM current_predictions`
    ),
    readQuery(`WITH current_predictions AS (
         SELECT DISTINCT ON (p.enrollment_id)
                p.enrollment_id, p.at_risk, p.created_at
         FROM predictions p
         JOIN enrollments e ON e.id = p.enrollment_id
         JOIN academic_clocks ac ON ac.course_presentation_id = e.course_presentation_id
         WHERE p.day_of_course = ac.current_day
         ORDER BY p.enrollment_id, p.created_at DESC
       )
       SELECT COUNT(*) FROM current_predictions WHERE at_risk = true`
    ),
  ]);
  return {
    totalStudents: parseInt(students.rows[0].count),
    totalEnrollments: parseInt(enrollments.rows[0].count),
    latestPredictions: parseInt(predictions.rows[0].count),
    recentPredictions: parseInt(predictions.rows[0].count),
    atRiskStudents: parseInt(atRisk.rows[0].count),
  };
};

const getStudentDashboardSummary = async (idStudent) => {
  const enrollments = await readQuery(`SELECT e.id AS enrollment_id, cp.code_module, cp.code_presentation
     FROM enrollments e
     JOIN course_presentations cp ON cp.id = e.course_presentation_id
     WHERE e.id_student = $1
     ORDER BY e.id`,
    [idStudent]
  );

  const predictions = await readQuery(`WITH current_predictions AS (
       SELECT DISTINCT ON (p.enrollment_id)
              p.enrollment_id,
              p.day_of_course,
              p.risk_probability,
              p.risk_level,
              p.at_risk,
              p.recommended_action,
              p.explanation,
              p.created_at
       FROM predictions p
       JOIN enrollments e ON e.id = p.enrollment_id
       JOIN academic_clocks ac ON ac.course_presentation_id = e.course_presentation_id
       WHERE e.id_student = $1
         AND p.day_of_course = ac.current_day
       ORDER BY p.enrollment_id, p.created_at DESC
     )
     SELECT current_predictions.*, cp.code_module, cp.code_presentation
     FROM current_predictions
     JOIN enrollments e ON e.id = current_predictions.enrollment_id
     JOIN course_presentations cp ON cp.id = e.course_presentation_id
     ORDER BY current_predictions.risk_probability DESC`,
    [idStudent]
  );

  const latestPredictions = predictions.rows;

  return {
    idStudent,
    totalEnrollments: enrollments.rowCount,
    predictionCount: latestPredictions.length,
    atRiskCount: latestPredictions.filter((row) => row.at_risk).length,
    highestRisk: latestPredictions[0] || null,
    enrollments: enrollments.rows,
    predictions: latestPredictions,
  };
};

const getRecentPredictions = async (limit = 10) => {
  const result = await readQuery(`WITH current_predictions AS (
       SELECT DISTINCT ON (p.enrollment_id)
              p.id,
              p.enrollment_id,
              p.day_of_course,
              p.risk_level,
              p.risk_probability,
              p.at_risk,
              p.recommended_action,
              p.created_at
       FROM predictions p
       JOIN enrollments e ON e.id = p.enrollment_id
       JOIN academic_clocks ac ON ac.course_presentation_id = e.course_presentation_id
       WHERE p.day_of_course = ac.current_day
       ORDER BY p.enrollment_id, p.created_at DESC
     )
     SELECT p.id, p.day_of_course, p.risk_level, p.risk_probability, p.at_risk, p.recommended_action, p.created_at,
            s.student_name, cp.code_module
     FROM current_predictions p
     JOIN enrollments e ON p.enrollment_id = e.id
     JOIN students s ON e.id_student = s.id_student
     JOIN course_presentations cp ON e.course_presentation_id = cp.id
     ORDER BY p.created_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
};

const getRiskDistribution = async () => {
  const result = await readQuery(`WITH current_predictions AS (
       SELECT DISTINCT ON (p.enrollment_id)
              p.enrollment_id, p.risk_level
       FROM predictions p
       JOIN enrollments e ON e.id = p.enrollment_id
       JOIN academic_clocks ac ON ac.course_presentation_id = e.course_presentation_id
       WHERE p.day_of_course = ac.current_day
       ORDER BY p.enrollment_id, p.created_at DESC
     )
     SELECT risk_level, COUNT(*) as count
     FROM current_predictions
     GROUP BY risk_level`
  );
  return result.rows;
};

const getStudentBehaviorData = async (idStudent) => {
  const result = await readQuery(`SELECT
       e.id AS enrollment_id,
       e.id_student,
       cp.code_module,
       cp.code_presentation,
       ac.current_day,
       ac.max_day,
       COALESCE(vle.total_clicks, 0)::int AS total_clicks,
       COALESCE(vle.quiz_clicks, 0)::int AS quiz_clicks,
       COALESCE(vle.forumng_clicks, 0)::int AS forumng_clicks,
       COALESCE(vle.resource_clicks, 0)::int AS resource_clicks,
       COALESCE(vle.active_days, 0)::int AS active_days,
       CASE
         WHEN vle.last_activity_day IS NULL THEN NULL
         ELSE ac.current_day - vle.last_activity_day
       END AS days_since_last_click,
       COALESCE(vle.click_trend, 0)::int AS click_trend,
       COALESCE(vle.click_consistency, 0)::float AS click_consistency,
       COALESCE(assess.avg_score, 0)::float AS avg_score,
       COALESCE(assess.avg_tma_score, 0)::float AS avg_tma_score,
       COALESCE(assess.avg_cma_score, 0)::float AS avg_cma_score,
       COALESCE(assess.num_submitted, 0)::int AS num_submitted,
       COALESCE(assess.num_failed, 0)::int AS num_failed,
       COALESCE(assess.submission_rate, 0)::float AS submission_rate,
       COALESCE(assess.avg_days_late, 0)::float AS avg_days_late,
       COALESCE(assess.score_trend, 0)::float AS score_trend,
       COALESCE(assess.submission_consistency, 0)::float AS submission_consistency,
       latest_assessment.id AS latest_assessment_id,
       latest_assessment.score::float AS latest_score,
       latest_assessment.date_submitted AS latest_date_submitted,
       latest_assessment.due_date AS latest_due_date,
       latest_assessment.assessment_type AS latest_assessment_type,
       latest_tma.id AS latest_tma_id,
       latest_tma.score::float AS latest_tma_score,
       latest_tma.date_submitted AS latest_tma_date_submitted,
       latest_tma.due_date AS latest_tma_due_date,
       latest_cma.id AS latest_cma_id,
       latest_cma.score::float AS latest_cma_score,
       latest_cma.date_submitted AS latest_cma_date_submitted,
       latest_cma.due_date AS latest_cma_due_date,
       next_tma.id_assessment AS next_tma_assessment_id,
       next_tma.date AS next_tma_due_date,
       next_cma.id_assessment AS next_cma_assessment_id,
       next_cma.date AS next_cma_due_date
     FROM enrollments e
     JOIN course_presentations cp ON cp.id = e.course_presentation_id
     JOIN academic_clocks ac ON ac.course_presentation_id = e.course_presentation_id
     LEFT JOIN LATERAL (
       SELECT
         SUM(sve.sum_click) AS total_clicks,
         SUM(sve.sum_click) FILTER (WHERE vs.activity_type = 'quiz') AS quiz_clicks,
         SUM(sve.sum_click) FILTER (WHERE vs.activity_type = 'forumng') AS forumng_clicks,
         SUM(sve.sum_click) FILTER (WHERE vs.activity_type IN ('resource', 'oucontent')) AS resource_clicks,
         COUNT(DISTINCT sve.date) AS active_days,
         MAX(sve.date) AS last_activity_day,
         SUM(sve.sum_click) FILTER (WHERE sve.date > ac.current_day / 2.0)
           - SUM(sve.sum_click) FILTER (WHERE sve.date <= ac.current_day / 2.0) AS click_trend,
         COUNT(DISTINCT sve.date)::float / NULLIF(ac.current_day, 0) AS click_consistency
       FROM student_vle_events sve
       JOIN vle_sites vs ON vs.id_site = sve.id_site
       WHERE sve.enrollment_id = e.id
         AND sve.date <= ac.current_day
     ) vle ON true
     LEFT JOIN LATERAL (
       WITH submitted AS (
         SELECT
           sa.score,
           sa.date_submitted,
           a.date,
           a.assessment_type,
           ROW_NUMBER() OVER (ORDER BY sa.date_submitted, sa.id) AS rn,
           COUNT(*) OVER () AS cnt
         FROM student_assessments sa
         JOIN assessments a ON a.id_assessment = sa.id_assessment
         WHERE sa.enrollment_id = e.id
           AND sa.date_submitted <= ac.current_day
       ),
       total_assessments AS (
         SELECT COUNT(*)::float AS total
         FROM assessments a
         WHERE a.course_presentation_id = e.course_presentation_id
       )
       SELECT
         AVG(score) AS avg_score,
         AVG(score) FILTER (WHERE assessment_type = 'TMA') AS avg_tma_score,
         AVG(score) FILTER (WHERE assessment_type = 'CMA') AS avg_cma_score,
         COUNT(*) AS num_submitted,
         COUNT(*) FILTER (WHERE score < 40) AS num_failed,
         COUNT(*)::float / NULLIF((SELECT total FROM total_assessments), 0) AS submission_rate,
         AVG(date_submitted - date) FILTER (WHERE date IS NOT NULL) AS avg_days_late,
         AVG(score) FILTER (WHERE rn > cnt / 2.0) - AVG(score) FILTER (WHERE rn <= cnt / 2.0) AS score_trend,
         AVG(CASE WHEN date IS NOT NULL AND date_submitted <= date THEN 1.0 ELSE 0.0 END) AS submission_consistency
       FROM submitted
     ) assess ON true
     LEFT JOIN LATERAL (
       SELECT
         sa.id,
         sa.score,
         sa.date_submitted,
         a.date AS due_date,
         a.assessment_type
       FROM student_assessments sa
       JOIN assessments a ON a.id_assessment = sa.id_assessment
       WHERE sa.enrollment_id = e.id
         AND sa.date_submitted <= ac.current_day
       ORDER BY sa.date_submitted DESC, sa.id DESC
       LIMIT 1
     ) latest_assessment ON true
     LEFT JOIN LATERAL (
       SELECT
         sa.id,
         sa.score,
         sa.date_submitted,
         a.date AS due_date
       FROM student_assessments sa
       JOIN assessments a ON a.id_assessment = sa.id_assessment
       WHERE sa.enrollment_id = e.id
         AND sa.date_submitted <= ac.current_day
         AND a.assessment_type = 'TMA'
       ORDER BY sa.date_submitted DESC, sa.id DESC
       LIMIT 1
     ) latest_tma ON true
     LEFT JOIN LATERAL (
       SELECT
         sa.id,
         sa.score,
         sa.date_submitted,
         a.date AS due_date
       FROM student_assessments sa
       JOIN assessments a ON a.id_assessment = sa.id_assessment
       WHERE sa.enrollment_id = e.id
         AND sa.date_submitted <= ac.current_day
         AND a.assessment_type = 'CMA'
       ORDER BY sa.date_submitted DESC, sa.id DESC
       LIMIT 1
     ) latest_cma ON true
     LEFT JOIN LATERAL (
       SELECT
         a.id_assessment,
         a.date
       FROM assessments a
       WHERE a.course_presentation_id = e.course_presentation_id
         AND a.assessment_type = 'TMA'
         AND NOT EXISTS (
           SELECT 1
           FROM student_assessments sa
           WHERE sa.enrollment_id = e.id
             AND sa.id_assessment = a.id_assessment
         )
       ORDER BY a.date NULLS LAST, a.id_assessment
       LIMIT 1
     ) next_tma ON true
     LEFT JOIN LATERAL (
       SELECT
         a.id_assessment,
         a.date
       FROM assessments a
       WHERE a.course_presentation_id = e.course_presentation_id
         AND a.assessment_type = 'CMA'
         AND NOT EXISTS (
           SELECT 1
           FROM student_assessments sa
           WHERE sa.enrollment_id = e.id
             AND sa.id_assessment = a.id_assessment
         )
       ORDER BY a.date NULLS LAST, a.id_assessment
       LIMIT 1
     ) next_cma ON true
     WHERE e.id_student = $1
     ORDER BY e.id`,
    [idStudent]
  );
  return result.rows;
};

const getCurrentStudentPrediction = async (idStudent, codeModule = null, codePresentation = null) => {
  const filters = ['e.id_student = $1'];
  const params = [idStudent];

  if (codeModule) {
    params.push(codeModule);
    filters.push(`cp.code_module = $${params.length}`);
  }

  if (codePresentation) {
    params.push(codePresentation);
    filters.push(`cp.code_presentation = $${params.length}`);
  }

  const result = await readQuery(`SELECT
       p.enrollment_id,
       p.day_of_course,
       p.risk_probability,
       p.risk_level,
       p.at_risk,
       p.threshold_used,
       p.recommended_action,
       p.explanation,
       p.model_confidence,
       p.data_completeness,
       p.created_at,
       cp.code_module,
       cp.code_presentation
     FROM predictions p
     JOIN enrollments e ON e.id = p.enrollment_id
     JOIN course_presentations cp ON cp.id = e.course_presentation_id
     JOIN academic_clocks ac ON ac.course_presentation_id = e.course_presentation_id
     WHERE ${filters.join(' AND ')}
       AND p.day_of_course = ac.current_day
     ORDER BY p.created_at DESC
     LIMIT 1`,
    params
  );

  return result.rows[0] || null;
};

const getCourseStats = async () => {
  const result = await readQuery(`WITH current_predictions AS (
       SELECT DISTINCT ON (p.enrollment_id)
              p.enrollment_id, p.risk_probability
       FROM predictions p
       JOIN enrollments e ON e.id = p.enrollment_id
       JOIN academic_clocks ac ON ac.course_presentation_id = e.course_presentation_id
       WHERE p.day_of_course = ac.current_day
       ORDER BY p.enrollment_id, p.created_at DESC
     )
     SELECT cp.code_module, COUNT(e.id) as enrollments,
            AVG(p.risk_probability) as avg_risk
     FROM course_presentations cp
     LEFT JOIN enrollments e ON cp.id = e.course_presentation_id
     LEFT JOIN current_predictions p ON e.id = p.enrollment_id
     GROUP BY cp.code_module
     ORDER BY enrollments DESC
     LIMIT 8`
  );
  return result.rows;
};

const getLatestPredictionRiskCounts = async () => {
  const result = await readQuery(`WITH current_predictions AS (
       SELECT DISTINCT ON (p.enrollment_id)
              p.enrollment_id,
              p.risk_level,
              p.at_risk
       FROM predictions p
       JOIN enrollments e ON e.id = p.enrollment_id
       JOIN academic_clocks ac ON ac.course_presentation_id = e.course_presentation_id
       WHERE p.day_of_course = ac.current_day
       ORDER BY p.enrollment_id, p.created_at DESC
     )
     SELECT
       COUNT(*)::int AS total_predictions,
       COUNT(*) FILTER (WHERE at_risk = true)::int AS at_risk_count,
       COUNT(*) FILTER (WHERE at_risk = false)::int AS not_at_risk_count,
       COUNT(*) FILTER (WHERE risk_level = 'HIGH')::int AS high_risk_count,
       COUNT(*) FILTER (WHERE risk_level = 'MEDIUM')::int AS medium_risk_count,
       COUNT(*) FILTER (WHERE risk_level = 'LOW')::int AS low_risk_count
     FROM current_predictions`
  );
  return result.rows[0];
};

const getCurrentAtRiskStudents = async ({ riskLevel = null, atRisk = null, limit = 50 } = {}) => {
  const filters = [];
  const params = [limit];

  if (riskLevel) {
    params.push(String(riskLevel).toUpperCase());
    filters.push(`p.risk_level = $${params.length}`);
  }

  if (atRisk !== null && atRisk !== undefined) {
    params.push(atRisk === true || atRisk === 'true');
    filters.push(`p.at_risk = $${params.length}`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const result = await readQuery(`WITH current_predictions AS (
       SELECT DISTINCT ON (p.enrollment_id)
              p.enrollment_id,
              p.day_of_course,
              p.risk_probability,
              p.risk_level,
              p.at_risk,
              p.recommended_action,
              p.explanation,
              p.created_at
       FROM predictions p
       JOIN enrollments e ON e.id = p.enrollment_id
       JOIN academic_clocks ac ON ac.course_presentation_id = e.course_presentation_id
       WHERE p.day_of_course = ac.current_day
       ORDER BY p.enrollment_id, p.created_at DESC
     )
     SELECT
       p.enrollment_id,
       e.id_student,
       cp.code_module,
       cp.code_presentation,
       p.day_of_course,
       p.risk_probability,
       p.risk_level,
       p.at_risk,
       p.recommended_action,
       p.explanation,
       p.created_at
     FROM current_predictions p
     JOIN enrollments e ON e.id = p.enrollment_id
     JOIN course_presentations cp ON cp.id = e.course_presentation_id
     ${whereClause}
     ORDER BY p.risk_probability DESC, p.created_at DESC
     LIMIT $1`,
    params
  );

  return result.rows;
};

module.exports = {
  findUserByUsername,
  findStudentById,
  listRegisterableCoursePresentations,
  registerStudentWithEnrollment,
  getUserById,
  getStudentUserById,
  getDashboardStats,
  getStudentDashboardSummary,
  getStudentBehaviorData,
  getCurrentStudentPrediction,
  getRecentPredictions,
  getRiskDistribution,
  getCourseStats,
  getLatestPredictionRiskCounts,
  getCurrentAtRiskStudents,
};
