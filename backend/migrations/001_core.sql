-- Bootstrap for a fresh development database. Existing EduPredict tables are
-- retained. This schema covers only columns consumed by the EduFusion gateway.
CREATE TABLE IF NOT EXISTS app_users (
  id SERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','advisor','student')), is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS students (
  id_student INTEGER PRIMARY KEY, student_name TEXT NOT NULL, email TEXT, pin_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS course_presentations (
  id SERIAL PRIMARY KEY, code_module TEXT NOT NULL, code_presentation TEXT NOT NULL,
  module_presentation_length INTEGER NOT NULL, UNIQUE(code_module,code_presentation)
);
CREATE TABLE IF NOT EXISTS academic_clocks (
  id SERIAL PRIMARY KEY, course_presentation_id INTEGER NOT NULL UNIQUE REFERENCES course_presentations(id),
  current_day INTEGER NOT NULL DEFAULT 0, max_day INTEGER NOT NULL,
  last_tick_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS enrollments (
  id SERIAL PRIMARY KEY, id_student INTEGER NOT NULL REFERENCES students(id_student),
  course_presentation_id INTEGER NOT NULL REFERENCES course_presentations(id),
  gender TEXT, region TEXT, highest_education TEXT, imd_band TEXT, age_band TEXT,
  num_of_prev_attempts INTEGER NOT NULL DEFAULT 0, studied_credits INTEGER NOT NULL DEFAULT 60,
  disability TEXT, final_result TEXT NOT NULL DEFAULT 'Registered', date_registration INTEGER, date_unregistration INTEGER,
  UNIQUE(id_student,course_presentation_id)
);
CREATE TABLE IF NOT EXISTS vle_sites (
  id_site INTEGER PRIMARY KEY, course_presentation_id INTEGER NOT NULL REFERENCES course_presentations(id), activity_type TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS student_vle_events (
  id SERIAL PRIMARY KEY, enrollment_id INTEGER NOT NULL REFERENCES enrollments(id), id_site INTEGER NOT NULL REFERENCES vle_sites(id_site),
  date INTEGER NOT NULL, sum_click INTEGER NOT NULL CHECK(sum_click>=0)
);
CREATE TABLE IF NOT EXISTS assessments (
  id_assessment INTEGER PRIMARY KEY, course_presentation_id INTEGER NOT NULL REFERENCES course_presentations(id),
  assessment_type TEXT NOT NULL, date INTEGER, weight NUMERIC
);
CREATE TABLE IF NOT EXISTS student_assessments (
  id SERIAL PRIMARY KEY, enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
  id_assessment INTEGER NOT NULL REFERENCES assessments(id_assessment), date_submitted INTEGER NOT NULL,
  is_banked BOOLEAN NOT NULL DEFAULT false, score NUMERIC CHECK(score>=0 AND score<=100)
);
CREATE TABLE IF NOT EXISTS predictions (
  id SERIAL PRIMARY KEY, enrollment_id INTEGER NOT NULL REFERENCES enrollments(id), day_of_course INTEGER NOT NULL,
  risk_probability NUMERIC NOT NULL CHECK(risk_probability>=0 AND risk_probability<=1), risk_level TEXT NOT NULL,
  at_risk BOOLEAN NOT NULL, threshold_used NUMERIC, recommended_action TEXT, explanation JSONB,
  model_confidence JSONB, data_completeness JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS edufusion_predictions_current_idx ON predictions(enrollment_id,day_of_course,created_at DESC);
CREATE INDEX IF NOT EXISTS edufusion_enrollments_student_idx ON enrollments(id_student);
CREATE INDEX IF NOT EXISTS edufusion_vle_enrollment_day_idx ON student_vle_events(enrollment_id,date);
CREATE INDEX IF NOT EXISTS edufusion_assessments_enrollment_day_idx ON student_assessments(enrollment_id,date_submitted);
