const { query } = require('./index');

const findUserByUsername = async (username) => {
  const result = await query(
    'SELECT id, username, password_hash, role, is_active FROM app_users WHERE username = $1',
    [username]
  );
  return result.rows[0] || null;
};

const findStudentById = async (idStudent) => {
  const result = await query(
    'SELECT id_student, student_name, pin_hash FROM students WHERE id_student = $1',
    [idStudent]
  );
  return result.rows[0] || null;
};

const getUserById = async (id) => {
  const result = await query(
    'SELECT id, username, role, is_active, created_at FROM app_users WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
};

const getStudentUserById = async (idStudent) => {
  const result = await query(
    'SELECT id_student, student_name, created_at FROM students WHERE id_student = $1',
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

const upsertChatSession = async (sessionId, idStudent) => {
  await query(
    `INSERT INTO chat_sessions (session_id, id_student, created_at, expires_at)
     VALUES ($1, $2, NOW(), NOW() + INTERVAL '7 days')
     ON CONFLICT (session_id) DO UPDATE
     SET id_student = EXCLUDED.id_student,
         expires_at = EXCLUDED.expires_at`,
    [sessionId, idStudent]
  );
};

const getDashboardStats = async () => {
  const [students, enrollments, predictions, atRisk] = await Promise.all([
    query('SELECT COUNT(*) FROM students'),
    query('SELECT COUNT(*) FROM enrollments'),
    query('SELECT COUNT(*) FROM predictions WHERE created_at > NOW() - INTERVAL \'30 days\''),
    query("SELECT COUNT(*) FROM predictions WHERE at_risk = true AND created_at > NOW() - INTERVAL '7 days'"),
  ]);
  return {
    totalStudents: parseInt(students.rows[0].count),
    totalEnrollments: parseInt(enrollments.rows[0].count),
    recentPredictions: parseInt(predictions.rows[0].count),
    atRiskStudents: parseInt(atRisk.rows[0].count),
  };
};

const getStudentDashboardSummary = async (idStudent) => {
  const enrollments = await query(
    `SELECT e.id AS enrollment_id, cp.code_module, cp.code_presentation
     FROM enrollments e
     JOIN course_presentations cp ON cp.id = e.course_presentation_id
     WHERE e.id_student = $1
     ORDER BY e.id`,
    [idStudent]
  );

  const predictions = await query(
    `WITH latest AS (
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
       WHERE e.id_student = $1
       ORDER BY p.enrollment_id, p.day_of_course DESC, p.created_at DESC
     )
     SELECT latest.*, cp.code_module, cp.code_presentation
     FROM latest
     JOIN enrollments e ON e.id = latest.enrollment_id
     JOIN course_presentations cp ON cp.id = e.course_presentation_id
     ORDER BY latest.risk_probability DESC`,
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
  const result = await query(
    `SELECT p.id, p.risk_level, p.risk_probability, p.at_risk, p.recommended_action, p.created_at,
            s.student_name, cp.code_module
     FROM predictions p
     JOIN enrollments e ON p.enrollment_id = e.id
     JOIN students s ON e.id_student = s.id_student
     JOIN course_presentations cp ON e.course_presentation_id = cp.id
     ORDER BY p.created_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
};

const getRiskDistribution = async () => {
  const result = await query(
    `SELECT risk_level, COUNT(*) as count 
     FROM predictions 
     WHERE created_at > NOW() - INTERVAL '30 days'
     GROUP BY risk_level`
  );
  return result.rows;
};

const getCourseStats = async () => {
  const result = await query(
    `SELECT cp.code_module, COUNT(e.id) as enrollments,
            AVG(CASE WHEN p.risk_probability IS NOT NULL THEN p.risk_probability ELSE 0 END) as avg_risk
     FROM course_presentations cp
     LEFT JOIN enrollments e ON cp.id = e.course_presentation_id
     LEFT JOIN predictions p ON e.id = p.enrollment_id
     GROUP BY cp.code_module
     ORDER BY enrollments DESC
     LIMIT 8`
  );
  return result.rows;
};

module.exports = {
  findUserByUsername,
  findStudentById,
  getUserById,
  getStudentUserById,
  upsertChatSession,
  getDashboardStats,
  getStudentDashboardSummary,
  getRecentPredictions,
  getRiskDistribution,
  getCourseStats,
};
