-- Private grading basis for new questions only. No historical rows rewritten.
ALTER TABLE edufusion_oral_exam_turns ADD COLUMN IF NOT EXISTS grading_criteria JSONB;
ALTER TABLE edufusion_oral_exam_turns ADD CONSTRAINT oral_exam_grading_criteria_array CHECK (grading_criteria IS NULL OR jsonb_typeof(grading_criteria)='array');
