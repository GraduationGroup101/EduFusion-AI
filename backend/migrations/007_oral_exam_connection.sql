-- The browser instance can reclaim its own stale connection even if a welcome
-- acknowledgement was lost. The server-side lease token still rotates to fence
-- every operation from the previous socket. This capability is never public.
ALTER TABLE edufusion_oral_exam_sessions ADD COLUMN lease_client_id UUID;
