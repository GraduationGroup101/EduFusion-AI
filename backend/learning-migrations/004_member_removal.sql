-- Removing a lecture ends a member's access but keeps the record that they saved
-- it, so administrators still see who saved each lecture.
ALTER TABLE study_members ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
