-- Explicit applications retain the previous evidence for audit/recovery.
-- Deleting a hypothetical scenario cannot remove this history.
CREATE TABLE IF NOT EXISTS edufusion_scenario_applications (
  revision UUID PRIMARY KEY,
  id_student INTEGER NOT NULL REFERENCES students(id_student),
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  before_data JSONB NOT NULL,
  scenario JSONB NOT NULL
);
