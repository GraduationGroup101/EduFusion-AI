CREATE TABLE edufusion_oral_exam_sessions (
  id UUID PRIMARY KEY,
  owner_key TEXT NOT NULL,
  id_student INTEGER REFERENCES students(id_student) ON DELETE CASCADE,
  user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  source JSONB NOT NULL,
  material_title TEXT NOT NULL,
  context JSONB NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('en','ar')),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','active','completed','timed_out','aborted','failed')),
  started_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, ended_at TIMESTAMPTZ,
  termination_reason TEXT,
  evaluation JSONB, evaluation_status TEXT NOT NULL DEFAULT 'pending' CHECK(evaluation_status IN ('pending','ready','failed')),
  lease_token UUID, lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(owner_key,request_key),
  CHECK ((id_student IS NULL) <> (user_id IS NULL)),
  CHECK (owner_key=CASE WHEN id_student IS NOT NULL THEN 'student:'||id_student ELSE 'user:'||user_id END),
  CHECK ((started_at IS NULL AND expires_at IS NULL) OR expires_at=started_at+INTERVAL '10 minutes'),
  CHECK (status<>'active' OR (started_at IS NOT NULL AND ended_at IS NULL)),
  CHECK (ended_at IS NULL OR started_at IS NULL OR (ended_at>=started_at AND ended_at<=expires_at))
);
CREATE UNIQUE INDEX edufusion_oral_exam_one_active ON edufusion_oral_exam_sessions(owner_key) WHERE status='active';
CREATE INDEX edufusion_oral_exam_owner ON edufusion_oral_exam_sessions(owner_key,created_at DESC);
CREATE INDEX edufusion_oral_exam_expiry ON edufusion_oral_exam_sessions(expires_at) WHERE status='active';
CREATE TABLE edufusion_oral_exam_turns (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES edufusion_oral_exam_sessions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK(sequence>0),
  question TEXT NOT NULL,
  concept TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK(question_type IN ('initial','follow_up','next_topic')),
  difficulty TEXT NOT NULL CHECK(difficulty IN ('foundation','application','analysis')),
  citations JSONB NOT NULL,
  transcript TEXT,
  assessment JSONB,
  follow_up_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), answered_at TIMESTAMPTZ,
  UNIQUE(session_id,sequence)
);
