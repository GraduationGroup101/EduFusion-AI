-- Widen legacy PIN columns before storing bcrypt / versioned legacy hashes.
ALTER TABLE students ALTER COLUMN pin_hash TYPE TEXT;
CREATE TABLE IF NOT EXISTS edufusion_chat_history (
  owner_key TEXT NOT NULL, session_id TEXT NOT NULL, messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(owner_key,session_id)
);
CREATE INDEX IF NOT EXISTS edufusion_chat_expiry_idx ON edufusion_chat_history(expires_at);
CREATE TABLE IF NOT EXISTS edufusion_lecture_jobs (
  owner_key TEXT NOT NULL, job_id TEXT NOT NULL, job JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(owner_key,job_id)
);
CREATE TABLE IF NOT EXISTS edufusion_student_scenarios (
  id_student INTEGER NOT NULL REFERENCES students(id_student) ON DELETE CASCADE,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(id_student,enrollment_id)
);
