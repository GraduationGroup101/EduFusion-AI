-- Durable transcript cache: the transcription service runs on ephemeral hosting,
-- so completed text is kept here and reused when another account submits the
-- same video. Lecture tools (chat, practice questions) read from this copy.
CREATE TABLE IF NOT EXISTS edufusion_lecture_transcripts (
  job_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('raw','cleaned')),
  video_id TEXT,
  title TEXT,
  content TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, kind)
);
CREATE INDEX IF NOT EXISTS edufusion_lecture_transcripts_video_idx ON edufusion_lecture_transcripts(video_id, updated_at DESC);

-- Practice questions generated from a transcript, private to the requesting account.
CREATE TABLE IF NOT EXISTS edufusion_lecture_quizzes (
  id UUID PRIMARY KEY,
  owner_key TEXT NOT NULL,
  job_id TEXT NOT NULL,
  language TEXT NOT NULL,
  questions JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS edufusion_lecture_quizzes_owner_idx ON edufusion_lecture_quizzes(owner_key, job_id, created_at DESC);
