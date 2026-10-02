-- Additive metadata; existing answers and final reports remain intact.
ALTER TABLE edufusion_oral_exam_sessions ADD COLUMN core_evaluation JSONB;
ALTER TABLE edufusion_oral_exam_sessions ADD COLUMN technical_interruptions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE edufusion_oral_exam_sessions ADD COLUMN feedback_token UUID;
ALTER TABLE edufusion_oral_exam_sessions ADD COLUMN feedback_until TIMESTAMPTZ;
ALTER TABLE edufusion_oral_exam_turns ADD COLUMN category TEXT CHECK(category IN ('core','follow_up','bonus'));
ALTER TABLE edufusion_oral_exam_turns ADD COLUMN concept_key TEXT;
ALTER TABLE edufusion_oral_exam_turns ADD COLUMN parent_sequence INTEGER;
ALTER TABLE edufusion_oral_exam_turns ADD COLUMN transition TEXT;
ALTER TABLE edufusion_oral_exam_turns DROP CONSTRAINT edufusion_oral_exam_turns_question_type_check;
ALTER TABLE edufusion_oral_exam_turns ADD CHECK(question_type IN ('initial','next_topic','follow_up','bonus'));
