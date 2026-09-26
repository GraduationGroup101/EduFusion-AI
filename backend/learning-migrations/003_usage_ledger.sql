CREATE TABLE IF NOT EXISTS study_usage (
  owner_key TEXT NOT NULL, day DATE NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('prepare','chat','quiz')),
  requests INTEGER NOT NULL CHECK(requests>=0),
  PRIMARY KEY(owner_key,day,kind)
);
INSERT INTO study_usage(owner_key,day,kind,requests)
SELECT owner_key,(created_at AT TIME ZONE 'UTC')::date,kind,COUNT(*)::int
FROM study_jobs WHERE kind<>'prepare' OR stage<>'linked'
GROUP BY owner_key,(created_at AT TIME ZONE 'UTC')::date,kind
ON CONFLICT(owner_key,day,kind) DO NOTHING;
