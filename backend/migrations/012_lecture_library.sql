-- Durable lecture library. A stored transcript records the request that produced
-- it (requested language and processing mode), the language its text is really
-- in, and the transcription service's output format, so a lecture is reused
-- only for a compatible request. Rows written before this migration keep
-- format_version NULL: they may be English translations of Arabic lectures, so
-- their owners can still read them but they are never served to a new request.
ALTER TABLE edufusion_lecture_transcripts
  ADD COLUMN IF NOT EXISTS language TEXT,
  ADD COLUMN IF NOT EXISTS mode TEXT,
  ADD COLUMN IF NOT EXISTS detected_language TEXT,
  ADD COLUMN IF NOT EXISTS format_version TEXT,
  ADD COLUMN IF NOT EXISTS youtube_url TEXT;
CREATE INDEX IF NOT EXISTS edufusion_lecture_transcripts_reuse_idx
  ON edufusion_lecture_transcripts(video_id, format_version, mode, updated_at DESC);

-- Saved lectures are looked up by provider job (every owner of a shared job) and
-- listed newest first for administrators.
CREATE INDEX IF NOT EXISTS edufusion_lecture_jobs_job_idx ON edufusion_lecture_jobs(job_id);
CREATE INDEX IF NOT EXISTS edufusion_lecture_jobs_saved_idx ON edufusion_lecture_jobs(created_at DESC);
