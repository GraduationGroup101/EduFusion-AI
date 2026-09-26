-- Explicit provenance keeps legacy character PINs distinct from malformed hashes.
ALTER TABLE students ADD COLUMN IF NOT EXISTS pin_format TEXT;
UPDATE students SET pin_format = CASE
  WHEN pin_hash ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' THEN 'bcrypt'
  WHEN pin_hash ~ '^bcrypt-sha256\$\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' THEN 'bcrypt-sha256'
  ELSE 'legacy'
END WHERE pin_format IS NULL;
ALTER TABLE students ALTER COLUMN pin_format SET DEFAULT 'legacy';
ALTER TABLE students ALTER COLUMN pin_format SET NOT NULL;
