-- Conversational exchanges (repeat, clarification, nudge, retry) are stored on
-- the question they belong to. They are not answers: they never carry an
-- assessment and never count as a turn. Evaluation attempts keep a safe error
-- code so a retry can explain what happened last time.
ALTER TABLE edufusion_oral_exam_turns ADD COLUMN IF NOT EXISTS exchanges JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE edufusion_oral_exam_sessions ADD COLUMN IF NOT EXISTS evaluation_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE edufusion_oral_exam_sessions ADD COLUMN IF NOT EXISTS evaluation_error TEXT;
