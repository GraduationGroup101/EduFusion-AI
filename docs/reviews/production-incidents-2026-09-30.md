# Production Oral Exam and scenario investigation — 2026-09-30

## Evidence and root causes

### Oral Exam

The production frontend sends Oral Exam HTTP and WebSocket requests to `edufusion-backend.onrender.com/api`; other gateway traffic uses Vercel. Render was still following `codex/realtime-oral-exam`, serving `196db0e`, while Vercel served `main` (`15411ac`). Consequently the latest persisted connection capability/attempt recovery and material routes were absent on Render.

Render application logs in the requested 10:42–11:02 UTC window show `next_question` failures at 10:51:40 (400 `json_validate_failed`), 10:52:04 (`ungrounded_citation`), 10:52:05 (429 `rate_limit_exceeded`, followed by a connection error), and final-evaluation 429 failures at 10:52:17. These entries are from the same instance; no restart appears in this incident window. The old provider logs lack session IDs, so they establish the failure path and temporal correlation, not a uniquely identified session for every provider entry. There is no evidence of a fixed three-minute hosting timeout, token expiry or session cleanup causing this incident.

The runtime's provider-error catch sent the reported generic error and left the WebSocket open in phase `error`. The client only automatically recovered a closed/unhealthy socket. This stranded an otherwise live session. The fix closes recoverably (4500), sends a retry hint, and has the client recover even if the close handshake stalls. Welcome alone no longer resets the bounded retry budget. The existing database deadline, answers, lease fencing, five-second heartbeat and stale callback guards remain authoritative. Groq JSON-validation errors retry once; 429 honors Retry-After within the original deadline. A stalled STT open now rejects its waiting promise when closed/timed out.

### Material extraction

The frontend and source backend agree on authenticated multipart `POST /api/oral-exam/materials/extract`. A synthetic 1.7 MB `Lab01.docx` reproduced `Endpoint not found` in the production browser. The route exists on `main` but not the old deployed Render commit. The deployment branch mismatch caused the 404; changing the frontend URL would not fix it.

DOC support was also genuinely absent. The new pinned `word-extractor` adapter reads legacy OLE text in the existing bounded worker, rejects encryption/VBA and unreasonable sector counts, and preserves PDF/DOCX/PPTX/TXT/Markdown validation. No macro execution or temporary files. Upload cancellation/unmount now fences late responses so an older operation cannot clear a newer upload's state.

### Hypothetical scenarios

Historical commit `50f0a21` implements `updateStudentBehaviorData` behind `PUT /student/prediction-data/:enrollment_id`: it inserts `student_vle_events` and changes/inserts `student_assessments` (`score`, `date_submitted`), after which actual prediction generation can save to `predictions`. Commit `2101b19` replaced that boundary with isolated scenario storage. This establishes that prior hypothetical workflows could overwrite actual evidence.

The currently deployed EduPredict service is **nezarYousef/EduPredict**, Render `edupredict-api-isex`, commit `61375e66be256640d87e2a5e8eb3e67f231b7a52`. Its scenario route applies changes to copied Pydantic evidence and calls prediction without `save_prediction`; the actual route does save. Current gateway scenario writes target only `edufusion_student_scenarios`. We did not reproduce a current source-record write through these isolated paths. Previously stored hypothetical predictions were not retained, and the explicit Save as Actual operation was missing.

The fix retains inputs, timestamps, association, provider result and model metadata on the scenario. An explicit confirmed application runs in a serializable transaction, checks ownership/revision/day/full model evidence, updates actual activity/assessments and the matching prediction, and records a before-image. Retry is idempotent; deletion never reverts or edits actual records. Changed evidence and failed prediction persistence abort the entire transaction. Applied scenarios retain their result rather than adding their hypothetical deltas again.

## Data and deployment

- Additive migration `010_scenario_applications.sql` adds the application audit table. No historical records are rewritten.
- Render branch corrected to `main`; startup changed from `npm start` to `npm run migrate && npm start`. The main deployment applied the previously missing connection/conversation/attempt migrations successfully. No hosting tier, token lifetime, JWT secret, CORS wildcard or timeout increase.
- `/api/health` now exposes the deployed Git revision when available so branch drift can be diagnosed directly.
- No main merge is authorized or performed. Release/test commit details are recorded below as verification completes.

## Verification

- `npm run check`: ESLint, 142 backend tests, 102 frontend tests and production Vite build passed.
- Real 210-second localhost HTTP/WebSocket/PostgreSQL-compatible integration: 40 heartbeat clocks, forced disconnect at 190 seconds, two welcomes for the same session, three preserved answers and unchanged start/deadline. Model/voice are deterministic fixtures; this is not evidence of live provider availability.
- Regression coverage includes provider 400/429 handling, stuck STT open, retryable server errors with an open socket, PDF/DOC/DOCX extraction, encrypted/macro/malformed DOC rejection, 1.7 MB DOCX, scenario result persistence, ownership, explicit confirmation, stale evidence, idempotency, deletion isolation and transaction rollback.
- The repository's academic schema has no `attendance` field. The requested 60→90 invariant is exercised using a real TMA score: save/evaluate/reload/delete leaves 60; only confirmed application changes it to 90. Real activity and prediction writes are checked alongside it.
- Production runtime dependency audit reports zero vulnerabilities.

## Historical recovery and limits

The legacy write path did not retain before-images. A current value alone cannot establish whether it was originally real or hypothetical. Reliable recovery needs a pre-change database backup, audited original submissions/activity, or sufficiently detailed independent history. No speculative production repair was attempted. The new audit table only protects future explicit applications; it cannot reconstruct missing history.

Provider quotas, free-instance restarts and physical microphone quality remain external constraints. Recovery preserves time; it does not extend an exam while providers are unavailable. The legacy DOC parser is pinned and isolated; OCR, legacy PPT and protected/macro documents remain unsupported.
