CREATE TABLE IF NOT EXISTS edufusion_clock_commands (
  owner_key TEXT NOT NULL, request_key TEXT NOT NULL, command JSONB NOT NULL, result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(owner_key,request_key)
);
