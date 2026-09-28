# Oral Exam

Oral Exam adds a private, adaptive voice practice exam to the existing dashboard and a **Start Oral Exam** action to completed LectureScribe study workspaces. It does not change academic grades, predictions, the chatbot corpus, or the Quiz Generator API.

## Architecture and reference implementation

The existing Render Express backend owns HTTP and WebSocket traffic. No new service or database is required. The Vercel React frontend uses the existing authentication token and may direct only Oral Exam requests to Render through `VITE_ORAL_EXAM_API_URL`. Existing tools retain `VITE_API_URL`.

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

Final transcripts are saved before model work. An interrupted assessment can resume from that saved answer; an in-time answer is still available for the final report if the model exceeds the exam deadline. Uncommitted partial speech and audio are intentionally not replayed or stored. Two sockets cannot hold a valid lease simultaneously; stale sockets cannot publish or end a newer connection's active exam. Reconnect retries allow a crashed process's 20-second lease to expire.

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

WebSocket `/api/oral-exam/realtime` accepts an exact allowed Origin, then `{type:"hello",token,sessionId}` within ten seconds. Server messages include `welcome`, `clock`, `state`, `question`, `audio`, `error`, and `ended`. The browser sends 100 ms PCM16 binary frames while listening, and `{type:"played",sequence}` after actual question playback. Students cannot submit questions, evaluations, or transcript strings as socket events. Audio frames are at most 6,400 bytes; connection payload/rate/buffer caps reject oversized traffic. Tokens and provider keys never enter URLs.

## Deployment

Inspection on 2026-09-28 found existing `edufusion-backend` and `edufusion-frontend` Render services, a Render `edufusion-db` PostgreSQL database, and separate Vercel frontend/backend projects. Render's backend already runs `npm start` from `backend` and can mount the new WebSocket handler. Vercel's frontend uses root `frontend`, framework Vite; its API project uses root `backend`, framework Express. The Vercel project-details connector returned a schema mismatch; authenticated CLI inspection confirmed the settings. No cloud resources or production environment values were changed during implementation.

Apply after human review; this PR must not be merged automatically:

1. Back up and confirm the target `DATABASE_URL`, then run `npm run migrate --prefix backend` using the normal migration process. The two added tables are non-destructive to existing data. Do not run learning migrations against the academic database.
2. Configure the server-only provider group on the existing Render backend: `ORAL_EXAM_ENABLED`, `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_EN_VOICE_ID`, `ELEVENLABS_AR_VOICE_ID`. Set the enabled flag only when the group is complete. `ORAL_EXAM_MODEL` is optional and defaults to `llama-3.3-70b-versatile`. Existing `DATABASE_URL`, `JWT_SECRET`, TLS and frontend-origin settings remain required. Voice IDs must be usable by the selected provider account in the respective languages.
3. Deploy the reviewed backend with Node 22.13+ or 24+, and verify `/api/ready`. Keep the process long-lived; do not route this socket through the Vercel serverless API project.
4. If the frontend's existing API is Vercel, set only `VITE_ORAL_EXAM_API_URL` to the existing Render backend's HTTPS `/api` base. The browser derives its WSS URL from this setting. Rebuild the frontend. Never add provider keys to `VITE_*` or `NEXT_PUBLIC_*`.
5. Allow the exact frontend origin through existing `FRONTEND_URL`/`FRONTEND_URLS`. Preview origins and credentials are configured separately; do not allow wildcard Vercel domains or disable deployment protection.
6. Verify real Arabic/English microphone capture, transcription accuracy, TTS audibility, provider billing access, realistic latency and an uninterrupted ten-minute timeout on the deployed environment. Free Render sleeping/restarts can interrupt a connection; persisted deadlines and reconnect recovery do not promise uninterrupted availability.

The inspected free Render database reports an expiration of **2026-10-01**. Its owner must address that hosting lifecycle before relying on durable production exam data; this change does not modify the plan or purchase infrastructure.

Rollback: disable Oral Exam on Render and roll back the feature UI/backend deployment. Keep additive tables and existing student credentials. If explicitly uninstalling after exporting exam data, drop turns before sessions and remove only this migration's ledger row in a reviewed transaction. No destructive down migration runs automatically.

## Verification

`npm run check` covers lint, backend/frontend regressions and production build. The repository uses JavaScript/JSX and has no TypeScript configuration or separate typecheck command; ESLint and Vite parse the changed code, and Zod validates runtime model/API boundaries. Python lecture-engine tests and production dependency audits are also run.

The oral backend tests use migrated PGlite databases and actual WebSocket connections. They cover authentication/ownership, source membership, idempotency, one-active-exam enforcement, exact ten-minute timestamps, expiry after disconnect, stale leases, transcript persistence before model work, duplicate turn rejection, schema/citation validation, evaluation recovery, provider adapter failures and database failures.

For repeatable browser testing, start `backend/scripts/verifyOralExam.js` with `NODE_ENV=test`, then Vite on port 3110. This script creates an isolated in-memory database with a synthetic account, uses real routes/authentication/WebSockets, and injects deterministic providers; it refuses non-test mode and blocks external provider traffic. It is not imported by the application. Tests use a fake browser microphone and a short generated tone, so they prove capture/transport/playback integration, not provider quality.

See [the browser and review record](reviews/oral-exam-2026-09-28.md) for results and screenshots. Production migration, provider configuration, live-provider speech quality and hosted end-to-end testing remain release checks; local fixture results must not be represented as those checks passing.
