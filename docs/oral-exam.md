# Oral Exam

Oral Exam adds a private, adaptive voice practice exam to the existing dashboard and a **Start Oral Exam** action to completed LectureScribe study workspaces. It does not change academic grades, predictions, the chatbot corpus, or the Quiz Generator API.

## Architecture and reference implementation

The existing Render Express backend owns HTTP and WebSocket traffic. The old Free PostgreSQL instance was replaced with a new Free PostgreSQL 18 instance after a verified backup; no additional database remains. The Vercel React frontend uses the existing authentication token and directs only Oral Exam requests to Render through `VITE_ORAL_EXAM_API_URL`. Existing tools retain `VITE_API_URL`.

Studied Candidexa at commit `b3c7dacf00156b4755ba8eb255e25ad041c89df4`, especially `apps/web/server/realtime/{server,auth,connection}.ts`, `server/voice/providers/elevenlabs-realtime.ts`, `features/voice-capture/pcm16.ts`, and the transport, composed-voice, deployment, and reconnect documentation. Adapted patterns rather than importing its interview domain or Supabase implementation:

- Exact-origin WebSocket upgrade validation; access token in the first frame, never the URL.
- Server-only speech credentials, 16 kHz mono PCM16 microphone frames, bounded buffers and disposable audio.
- Separate streaming STT, adaptive reasoning, and TTS responsibilities.
- Heartbeats, cancellation, bounded reconnect backoff, rehydration from persisted questions, and graceful shutdown.
- Leases and ordered writes to reject stale connections and duplicate turns.

ElevenLabs Scribe v2 Realtime streams transcription with voice activity detection. Groq chooses the next question from the student's actual answer and a bounded set of source excerpts. ElevenLabs Flash v2.5 generates a short MP3 question. This MVP buffers each short spoken question before browser playback; microphone input is streamed continuously during the answer. It does not implement barge-in: capture is gated while the examiner speaks. Arabic and English are supported.

Provider contracts were checked against the [ElevenLabs realtime API](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime), [commit strategies](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies), and [Groq structured-output documentation](https://console.groq.com/docs/structured-outputs). Groq JSON mode is not treated as schema validation: Zod validates all questions, assessments, dimensions, and final reports before publication. Scores use 40% understanding, 30% accuracy, 20% completeness, and 10% communication. No-answer sessions are unscored, not given an invented zero.

## Material boundaries

- Completed, owned learning-library lectures reuse `study_chunks` through the existing owner-scoped store.
- Owned legacy LectureScribe jobs reuse the existing transcript download endpoint and gateway entitlement.
- New UTF-8 `.txt` files up to 90 KB and pasted text are supported. Files are read locally and sent as bounded text. Binary/empty content is rejected.

QuizForge accepts PDF/Word/PowerPoint but its gateway contract returns generated questions, not reusable extracted source text. There is no persisted upload/document entity or documented extraction endpoint to reuse. Those formats must be exported to text for this MVP; no parallel PDF/DOCX/PPTX ingestion stack was added. This is a deliberate supported-format limit.

Context uses up to 24 excerpts sampled across the complete source, including its tail. Existing chunks retain their IDs. Each decision selects current-question evidence, lexical matches, and uncovered excerpts. Questions must cite supplied excerpt IDs; invalid citations and repeated questions fail safely. This is bounded lecture-scoped retrieval, not a second vector store. The source snapshot belongs to the exam and remains stable if a lecture later changes. Source sampling and prompt instructions do not prove model factual correctness; representative material review is still required before broad rollout.

## Persistence, authentication, and timing

`backend/migrations/005_oral_exam.sql` runs through the existing academic/gateway migration command and ledger. It adds only `edufusion_oral_exam_sessions` and `edufusion_oral_exam_turns`, with indexed ownership, session/sequence uniqueness, student/application-account foreign keys, and a partial unique index for one active exam per account. Cross-database learning references remain source metadata because PostgreSQL cannot enforce a foreign key into the separate learning database. Existing user/lecture entities are not duplicated.

Preparation is idempotent per owner/request key; changed material with the same key returns 409. Starts are serialized per owner. The state path is `ready → active → completed | timed_out`, with `ready → aborted` for cancellation. A terminal session cannot restart. A maximum of 12 prepared exams per account per rolling day bounds provider/storage consumption; exams also stop after 30 answered turns.

The database fixes `expires_at = started_at + 10 minutes`. Repeated start and reconnect never write a new start or expiry. The WebSocket runtime arms an expiration timer, aborts providers, stops accepting audio/turns, and finalizes at the deadline. Turn and lease writes check database time, active state, lease token, and sequence. A 5-second sweep finalizes disconnected/expired sessions and pending reports; after process downtime the next request/sweep performs the same transition. `ended_at` is capped at the authoritative expiry. Physical row finalization may occur after the deadline during an outage, but no late answer/normal turn is accepted.

Final transcripts are saved before model work. An interrupted assessment can resume from that saved answer; an in-time answer is still available for the final report if the model exceeds the exam deadline. Uncommitted partial speech and audio are intentionally not replayed or stored. Two sockets cannot hold a valid lease simultaneously; stale sockets cannot publish or end a newer connection's active exam. Migration `007_oral_exam_connection.sql` adds a private per-mounted-browser capability so that browser can reclaim its own orphaned socket immediately while rotating the server-only write token. Another tab has a different capability and must wait for release/expiry. The capability stays in page memory, never browser storage, public responses or logs. Legacy clients without it retain lease-expiry recovery.

All routes use existing JWT/account authentication; IDs from the browser never establish ownership. The socket performs the same JWT/account lookup and a database ownership check before creating provider connections. Foreign and missing exams both fail without exposing transcripts or results. Provider diagnostics are reduced to safe error codes/names. JWT expiry also closes the socket.

Evaluation failure records `evaluation_status=failed`, preserves answers, and offers a bounded-rate manual retry. Empty exams receive an explicit unscored report. LLM reasoning traces are neither requested nor returned. EduFusion stores source excerpts, final transcripts, brief assessment feedback and evaluation; it does not store audio. Providers have their own retention policies.

## Routes and protocol

All HTTP routes are under `/api/oral-exam` and require a bearer token:

| Method/path | Purpose |
| --- | --- |
| GET `/status` | Configuration availability and maximum duration |
| GET `/materials` | Owned completed lectures/transcripts |
| GET `/sessions` | The owner's 30 most recent exams |
| POST `/sessions` | Prepare source snapshot; requires `Idempotency-Key` |
| GET `/sessions/:id` | Rehydrate authoritative state and saved results |
| POST `/sessions/:id/start` | Idempotently start the fixed ten-minute period |
| POST `/sessions/:id/end` | Stop and generate feedback |
| POST `/sessions/:id/evaluation` | Retry a final report after terminal state |

WebSocket `/api/oral-exam/realtime` accepts an exact allowed Origin, then `{type:"hello",token,sessionId,connectionKey}` within ten seconds. `connectionKey` is a private per-mounted-browser UUID; older clients may omit it. Server messages include `welcome` (with a safe diagnostic socket ID), `clock`, `state`, `question`, `audio`, `error`, and `ended`. The browser sends 100 ms PCM16 binary frames while listening, and `{type:"played",sequence}` after actual question playback. Students cannot submit questions, evaluations, or transcript strings as socket events. Audio frames are at most 6,400 bytes; connection payload/rate/buffer caps reject oversized traffic. Tokens and provider keys never enter URLs.

## Deployment

As of 2026-09-28, the verified custom-format backup was restored into the replacement Render PostgreSQL 18 Free database. Schema, migration ledger, table names, indexes, foreign keys, and key record counts matched the old database before migration. The repository's `backend/scripts/migrate.js` then applied `005_oral_exam.sql`; the production ledger contains 001–005 and both Oral Exam tables exist. The old database was deleted. The replacement Free database's lifecycle remains an operational item to monitor.

Oral Exam PR #10 was merged into `main` on 2026-09-29. The existing Render backend's database connection points to the replacement instance; `/api/health` and `/api/ready` return 200. The Vercel backend production deployment also points to the replacement database. The existing Render backend environment variables were retained, except that the old 15-character `JWT_SECRET` had to be rotated to satisfy startup validation. The same new secret is configured on both backends; sessions signed before that rotation require re-login.

The Render backend has `ORAL_EXAM_ENABLED=true` and the required server-only Groq/ElevenLabs keys and voice IDs. `ORAL_EXAM_MODEL=openai/gpt-oss-120b` is set; the hotfix uses this as its default because it supports Groq strict Structured Outputs. Provider secrets never enter `VITE_*` or browser responses. `VITE_ORAL_EXAM_API_URL` targets the Render HTTPS `/api` base in Vercel environment settings.

The existing Render static frontend origin and exact Vercel production/PR-preview origins are allowed through `FRONTEND_URL`/`FRONTEND_URLS`; no wildcard is configured. A foreign HTTP Origin received no CORS allow header, and a foreign WebSocket Origin received 403. Keep this socket on the long-lived Render backend rather than the Vercel serverless API project.

### 2026-09-29 Groq schema recovery hotfix

Render logged repeated final-evaluation `ZodError`s after a physical-microphone exam. JSON Object Mode guaranteed JSON syntax but did not enforce the decision/evaluation shapes. The hotfix requests [Groq strict Structured Outputs](https://console.groq.com/docs/structured-outputs) for `openai/gpt-oss-120b`. The provider JSON Schemas are generated from the same Zod contracts used to validate responses on the server, including required and closed nested objects. The model call retries at most once for a transient provider or validation failure; authentication errors and cancelled or expired exams do not retry. Logs include operation, attempt, error class, safe provider status/code, and Zod issue paths/codes without student content or raw model responses.

An accepted transcript remains stored before Groq is called. If both attempts fail, the active session and original deadline remain; reconnect resumes the incomplete turn. Final-evaluation failures preserve the ended exam and answers for the existing evaluation retry endpoint. The hotfix branch must be reviewed as a separate PR; no full-feature revert is intended.

The hotfix code commit `e4380a8` was deployed to Render for live verification. Three synthetic-audio sessions each completed four consecutive answered turns through WebSocket, ElevenLabs STT/TTS, and Groq, then persisted a final evaluation. All three reconnected without changing their 600-second deadline, and the temporary accounts and cascaded records were removed. The post-test Render logs contained no `ZodError`, final-evaluation failure, or connection failure. One first-attempt `repeated_question` semantic rejection was safely retried and the exam continued; no malformed turn was committed. This does not replace the user's planned real physical-microphone retest.

Live provider verification used a temporary account and synthetic speech: authenticated HTTP and WebSocket traffic, Groq question generation, ElevenLabs TTS playback bytes, ElevenLabs realtime STT traffic, an answered turn saved in PostgreSQL, reconnect without resetting `expires_at`, and a persisted final Groq evaluation all passed. The temporary account and its test records were removed. The authoritative timer was verified as exactly 600 seconds at start and unchanged after reconnect; a real unattended ten-minute browser run was not performed. **Physical microphone browser verification remains manual.** A human should also assess Arabic/English speech quality and audibility on actual devices. Free Render sleeping/restarts can interrupt a connection; persisted deadlines and reconnect recovery do not promise uninterrupted hosting.

Rollback: disable Oral Exam on Render and roll back the feature UI/backend deployment. Keep additive tables and existing student credentials. If explicitly uninstalling after exporting exam data, drop turns before sessions and remove only this migration's ledger row in a reviewed transaction. No destructive down migration runs automatically.

## Verification

The [September 30 connection reliability investigation](reviews/oral-exam-reliability-2026-09-30.md) records the orphan-lease reproduction, recovery patch, timeout trace and production-access limitations. Apply additive migration 007 to the shared academic/gateway database before deploying this backend. Enable `ORAL_EXAM_DIAGNOSTICS=true` temporarily for heartbeat/lease metadata when tracing an incident; credentials, capability keys and speech are excluded. A locally verified recovery defect does not establish the initial production disconnect or resolve an unrelated historical LectureScribe 502.

`npm run check` covers lint, backend/frontend regressions and production build. The repository uses JavaScript/JSX and has no TypeScript configuration or separate typecheck command; ESLint and Vite parse the changed code, and Zod validates runtime model/API boundaries. Python lecture-engine tests and production dependency audits are also run.

The oral backend tests use migrated PGlite databases and actual WebSocket connections. They cover authentication/ownership, source membership, idempotency, one-active-exam enforcement, exact ten-minute timestamps, expiry after disconnect, stale leases, transcript persistence before model work, duplicate turn rejection, schema/citation validation, evaluation recovery, provider adapter failures and database failures.

For repeatable browser testing, start `backend/scripts/verifyOralExam.js` with `NODE_ENV=test`, then Vite on port 3110. This script creates an isolated in-memory database with a synthetic account, uses real routes/authentication/WebSockets, and injects deterministic providers; it refuses non-test mode and blocks external provider traffic. It is not imported by the application. Tests use a fake browser microphone and a short generated tone, so they prove capture/transport/playback integration, not provider quality.

See [the browser and release verification record](reviews/oral-exam-2026-09-28.md) for results, production comparisons, screenshots, and remaining limits. Local fixture results and synthetic speech do not establish physical microphone quality.
