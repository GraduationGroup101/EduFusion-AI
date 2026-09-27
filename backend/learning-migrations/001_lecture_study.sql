CREATE TABLE IF NOT EXISTS study_lectures (
  id UUID PRIMARY KEY, source_key TEXT NOT NULL UNIQUE, youtube_url TEXT NOT NULL,
  language TEXT NOT NULL, title TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','ready','failed')),
  stage TEXT NOT NULL DEFAULT 'queued', raw_transcript TEXT, transcript TEXT,
  summary TEXT, sections JSONB NOT NULL DEFAULT '[]', concepts JSONB NOT NULL DEFAULT '[]',
  provider_job_id TEXT, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS study_members (
  owner_key TEXT NOT NULL, lecture_id UUID NOT NULL REFERENCES study_lectures(id),
  enrollment_id INTEGER, title TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(owner_key,lecture_id)
);
CREATE TABLE IF NOT EXISTS study_chunks (
  lecture_id UUID NOT NULL REFERENCES study_lectures(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, id TEXT NOT NULL, text TEXT NOT NULL, section TEXT NOT NULL,
  ordinal INTEGER NOT NULL, embedding REAL[], embedding_model TEXT,
  PRIMARY KEY(lecture_id,version,id),
  CHECK(embedding IS NULL OR array_length(embedding,1)=384)
);
CREATE TABLE IF NOT EXISTS study_jobs (
  id UUID PRIMARY KEY, owner_key TEXT NOT NULL, lecture_id UUID NOT NULL REFERENCES study_lectures(id),
  version INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('prepare','chat','quiz')),
  request_key TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
  stage TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), lease_until TIMESTAMPTZ, lease_token UUID,
  result JSONB, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(owner_key,request_key)
);
CREATE INDEX IF NOT EXISTS study_jobs_dispatch_idx ON study_jobs(status,available_at,lease_until);
CREATE INDEX IF NOT EXISTS study_jobs_owner_idx ON study_jobs(owner_key,created_at);
CREATE TABLE IF NOT EXISTS study_messages (
  id UUID PRIMARY KEY, owner_key TEXT NOT NULL, lecture_id UUID NOT NULL REFERENCES study_lectures(id),
  version INTEGER NOT NULL, job_id UUID NOT NULL REFERENCES study_jobs(id),
  question TEXT NOT NULL, answer TEXT, citations JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(job_id)
);
CREATE INDEX IF NOT EXISTS study_messages_scope_idx ON study_messages(owner_key,lecture_id,version,created_at);
CREATE TABLE IF NOT EXISTS study_quizzes (
  id UUID PRIMARY KEY REFERENCES study_jobs(id), owner_key TEXT NOT NULL,
  lecture_id UUID NOT NULL REFERENCES study_lectures(id), version INTEGER NOT NULL,
  questions JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS study_attempts (
  id UUID PRIMARY KEY, owner_key TEXT NOT NULL, quiz_id UUID NOT NULL REFERENCES study_quizzes(id),
  lecture_id UUID NOT NULL REFERENCES study_lectures(id), request_key TEXT NOT NULL,
  answers JSONB NOT NULL, feedback JSONB NOT NULL, score INTEGER, total INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(owner_key,request_key)
);
CREATE TABLE IF NOT EXISTS study_workers (
  id TEXT PRIMARY KEY, heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
