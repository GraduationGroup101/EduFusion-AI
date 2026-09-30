-- Orders connection attempts from one browser capability. A reclaim with the
-- same capability must carry a strictly newer attempt, so a delayed older
-- handshake can never replace a newer socket that already owns the exam.
ALTER TABLE edufusion_oral_exam_sessions ADD COLUMN lease_client_attempt INTEGER;
