# Lecture study integration

The lecture page now contains a private library. Every saved lecture opens a workspace with its summary, cited source text, an independent conversation and practice questions. A student can explain a concept, practise a section, submit answers, inspect feedback and ask the lecture chat about a mistake without leaving the lecture. Existing university chatbot and general question-generator pages remain unchanged. This implementation contains no changes or new calls to Final-Iug-Chat-Bot, its deployment or its MongoDB corpus.

## Data and ownership

`DATABASE_URL` continues to serve authentication and academic records. `LEARNING_DATABASE_URL` must identify a different PostgreSQL database. Its independent migrations run only through `migrate:learning`. Do not run academic migrations against a production database just to enable this feature. Use an account with permissions limited to the learning database, verified TLS remotely, and a separately stored backup key.

`study_lectures` stores one transcript/summary per canonical YouTube video, language and processing version (source key `<video>:<language>:study-v2`; v1 lectures may hold English translations of Arabic lectures, so a new request prepares them again while their members keep reading them). `study_members` grants library access and stores each account's course link and display title. Shared cached content does not grant access to someone else's conversation, job or quiz. Messages, question sets, submissions and idempotency keys use `student:<id>` or `user:<id>` ownership. Authentication checks the existing account before requests; the worker checks that account again before processing and publishing. Every artifact request verifies a current membership.

The gateway accepts a whitelisted YouTube URL. It never accepts a browser-supplied transcript or arbitrary retrieval URL. Importing an old completed transcript requires the caller's existing gateway entitlement. A lecture already prepared (or being prepared) from the same source is joined without any transcript. Otherwise the transcript is read from EduFusion's transcript library first, and only then downloaded from the configured LectureScribe provider (both kinds, stored for every later reader). Only text produced by the current pipeline (a format version on the stored copy or on the job) seeds the lecture: an older copy may be an English translation of an Arabic lecture, and the lecture is shared by everyone who saves that source, so the lecture is then prepared afresh in its own language. The original provider still performs transcription; its current API supplies plain text without verified timestamps. Source links therefore open cited text chunks, not invented video times.

Before submitting a lecture, the worker looks for a stored transcript in EduFusion's transcript library with the same video and a compatible language (formatted mode) and studies it without contacting the provider. Otherwise it submits the lecture with its language (including `'auto'`) and the gateway key, using a per-lecture `X-Gateway-User`. A provider that forgot the job (`404`/`410`, or both transcripts missing) gets the lecture again, at most three times per attempt; a provider that is unreachable is retried with backoff and keeps the job for the next attempt. Both downloaded kinds are stored in the transcript library, best effort. A formatted copy in another language than the speech is stored without a format version (never reused) and the spoken text is studied instead. Section summaries are written in the lecture's language.

## Processing and free operation

```mermaid
flowchart LR
    Student[Authenticated student] --> Gateway[EduFusion lecture API]
    Gateway --> Learning[(Independent learning PostgreSQL)]
    Learning --> Worker[Scheduled local worker]
    Worker --> Transcript[Existing LectureScribe transcription]
    Worker --> Engine[Independent Python study engine]
    Engine --> Ollama[Local Ollama]
    Engine --> Learning
    Academic[(Academic database)] -->|Owned course and cached prediction reads| Gateway
```

The PostgreSQL queue uses `FOR UPDATE SKIP LOCKED`, a five-minute renewable lease and a new fencing token on every claim. Pending work persists when the GPU machine is offline. There is no paid cloud inference service or always-on hosted worker requirement. One local worker dispatches chat/quiz work first and gives preparation every fourth dispatch an opportunity. Requests receive up to three automatic attempts with backoff, then expose a bounded manual retry. Worker heartbeat, saved status and storage warnings are visible in the lecture page. Checkpoints preserve the upstream transcription job, downloaded transcript, chunks and completed section summaries. Restarting a worker continues these stages.

Limits per account: two actual new preparations per UTC day, two pending preparations, 50 chat requests and ten quiz requests per UTC day, three pending requests of each type and one pending chat per lecture. Cached/shared ready content does not consume preparation compute. There are at most two manual retries for a failed request. The existing AI request limiter also applies. Removing a membership cancels that owner's pending work and deletes their conversations/practice and job payloads; preparation is requeued for another member when required, preserving shared content. The membership itself is kept with its removal time (learning migration `004_member_removal.sql`), without any access, so administrators still see who saved the lecture; saving it again starts a fresh membership. Clearing a conversation also deletes its job payloads. A separate aggregate usage ledger preserves daily limits after deletion without retaining question text, and expires after 90 days.

The initial storage budget is 500 MiB: warning at 70%, refusal of new AI work at 90%. Reads of saved content remain available. `cleanup:learning` deletes chat rows after 90 days, lectures nobody keeps 30 days after their last member removed them, and stale worker heartbeats. Schedule it daily on the machine/database you control. The local PostgreSQL cluster is a development setup; put shared deployment data on durable storage with backups before granting students remote access. Free hosting allowances and sleeping services still need operational verification.

## Retrieval and questions

The engine preserves the end of long transcripts, groups chunks into sections and summarizes every section. Its final summary concatenates those section summaries, avoiding an extra model call that could truncate the end of the lecture. New lecture chat retrieves only the selected lecture/version. History provides conversational context and is not treated as evidence. Missing supporting evidence produces a standard unknown answer. Chunk citations are checked in Python and again before database publication.

With `LECTURE_STUDY_EMBEDDINGS=true`, the worker loads multilingual E5-small locally on CPU, uses 400-token chunks with 50-token overlap, stores normalized 384-dimensional vectors and combines BM25 with exact cosine ranking using reciprocal rank fusion. Vectors remain in the learning database; no external embedding API receives the text. With the explicit `false` setting, the worker uses overlapping text chunks and Arabic-aware lexical retrieval without Python package/model downloads. Semantic mode must be installed and tested before enabling it; lexical mode is the working fallback for a machine with limited network access.

The first implementation uses PostgreSQL arrays and exact per-lecture ranking instead of requiring pgvector. The maximum corpus per request is 500 chunks, making ownership checks straightforward and avoiding approximate-index recall concerns for this scope. The durable queue also uses portable SQL instead of requiring a Supabase-specific queue extension. Move to pgvector/indexed retrieval when measurements show that per-lecture ranking or larger multi-lecture collections need it; do not expand retrieval scope implicitly.

Quiz generation distributes requested items across the selected sections, including the first and last when multiple items allow coverage. It requests structured JSON from local Ollama, validates exact counts, unique prompts, four MCQ choices, zero-based MCQ answers, Boolean true/false answers, essay model answers/rubrics and valid citations. Invalid output fails safely without publishing a partial quiz. The public quiz response excludes answer keys and explanations. Objective grading occurs server-side after submission. Essays use an explicit self-assessment rubric rather than a fabricated automatic grade.

Study recommendations use objective concept accuracy from the last 20 attempts only after at least three observations. An optional course link is verified against the student's own enrollment, then reads the current cached EduPredict prediction and its date. Study attempts never modify official grades, VLE events, model features or prediction rows. No model retraining is introduced.

## Enable a worker

1. Configure a separate durable PostgreSQL learning database and the variables below in the gateway and worker environment. Both need the learning URL; the worker also needs the existing academic URL for active-account checks. Keep credentials outside Git.
2. Install the backend dependencies, then run `npm run migrate:learning --prefix backend`. This creates only `study_*` tables and their separate migration ledger.
3. Install Python 3.11+ on the worker machine. Semantic retrieval requires `python -m pip install -r services/lecture-study/requirements.txt`; a CPU PyTorch build avoids an unnecessary CUDA package download. For an explicit lexical setup, Python's standard library is sufficient.
4. Start local Ollama, download the selected model, and test a short structured response before starting the worker. The default is `qwen2.5:7b-instruct`; set `LECTURE_STUDY_MODEL` to an installed model appropriate for available memory. The engine uses a small inference batch and memory mapping. `LECTURE_STUDY_GPU_LAYERS=0` forces CPU, while another nonnegative count controls partial GPU offload. Do not expose the Ollama port publicly.
5. Start `npm run worker:lectures --prefix backend` during the machine's available processing hours. Stopping it leaves requests in PostgreSQL; expired leases recover on the next run. Set `LECTURE_STUDY_PYTHON` to a virtual environment's executable when using one.
6. Enable the gateway flag after migrations. Open LectureScribe, save a lecture, wait for `ready`, ask a cited question and submit a practice quiz. Verify isolation with another account, then test offline queueing and a worker restart. Do not point a hosted gateway to a laptop's `localhost`; gateway and worker communicate through the durable learning database, and only the worker calls its local Ollama.

```dotenv
LECTURE_STUDY_ENABLED=true
LEARNING_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/learning
LEARNING_DB_SSL=true
LECTURE_STUDY_MAX_DB_MB=500
LECTURE_STUDY_PYTHON=python
LECTURE_STUDY_OLLAMA_URL=http://127.0.0.1:11434
LECTURE_STUDY_MODEL=qwen2.5:7b-instruct
LECTURE_STUDY_EMBEDDINGS=true
```

For a separate local test environment, load an ignored file without replacing the original `backend/.env`: run from `backend`, for example `node -r dotenv/config scripts/migrateLearning.js dotenv_config_path=.env.lecture-study.local`. Use the same preload for `src/index.js`, `scripts/lectureStudyWorker.js`, cleanup and backups. TLS may be disabled only for a loopback learning database.

## API

All paths start with `/api/lecture-study` and require the existing bearer session. Mutating preparation, chat, quiz and attempt requests require a stable `Idempotency-Key`; retry the same request with the same key after an uncertain network result. A changed payload with that key returns 409.

| Endpoint | Purpose |
| --- | --- |
| `GET /status` | Feature, worker and storage availability |
| `GET /lectures?offset=0` | Current account's library, 20 per page |
| `POST /lectures` | Canonical URL, optional language/title/owned enrollment; durable preparation |
| `POST /import` | Save a completed, owned legacy provider job |
| `GET /lectures/:id` | Owned lecture, chunks and current account's pending/failed jobs |
| `DELETE /lectures/:id` | End this account's access and delete its practice (administrators keep the record that it was saved) |
| `GET/POST/DELETE /lectures/:id/messages` | Private history, queued chat, clear conversation |
| `GET/POST /lectures/:id/quizzes` | Saved question sets or queued generation |
| `GET /quizzes/:id` | Questions without answer keys |
| `POST /quizzes/:id/attempts` | Server-side grading and feedback |
| `GET /lectures/:id/attempts` | Private attempt history |
| `GET /lectures/:id/recommendations` | Concept review and read-only course prediction |
| `GET /jobs/:id`, `POST /jobs/:id/retry` | Owner-scoped status and bounded retry |
| `GET /admin/lectures?offset=0`, `GET /admin/lectures/:id` | Administrators only: every lecture with `members` (`owner_key, type, id, name, saved_at, removed_at`) and `member_count` (current members) |

An accepted asynchronous request returns 202 plus its job ID. Missing/foreign identifiers return 404; unsupported input returns 400; not-ready content or changed idempotent requests return 409; capacity/quota limits return 429 with `Retry-After`; unavailable dependencies return 503. No provider bodies, database URLs or prompts are returned as failure details.

## Backup and recovery

Generate a private 32-byte random key, encode it as base64 and store it as `LEARNING_BACKUP_KEY` separately from the backup location. `npm run backup:learning --prefix backend -- PATH` writes a new AES-256-GCM authenticated, gzip-compressed snapshot of the learning tables from a consistent read-only transaction. It excludes academic records and database connection strings. Existing files are not overwritten. Logical snapshots are limited to 128 MiB; larger datasets need a database-native backup procedure.

To test recovery, create a new empty learning database, point only `LEARNING_DATABASE_URL` to it, apply the same learning migrations and run `npm run restore:learning --prefix backend -- PATH`. Restore authenticates the entire snapshot before writing, requires matching migration versions and empty target tables, and inserts all tables in one transaction. Running jobs are returned to the queue with old leases invalidated; worker heartbeat starts fresh. It never truncates an existing database. Confirm memberships, citations, attempt scores and resumed jobs before changing a gateway's URL. Keep the old database for rollback. Disabling `LECTURE_STUDY_ENABLED` removes the new processing path while keeping saved data and the original tools.

## Validation

The chat engine first asks the local model whether the supplied evidence can answer the current question; a negative decision returns the standard insufficient-evidence response without citations. This is a model guard, not a guarantee of factual correctness. Quiz generation uses separate, bounded batches for each question type and an explicit Arabic/English language. MCQ generation returns the exact correct option text, which the engine maps to its unique stored index; mismatched options are rejected. Unsupported language drift, foreign citations and malformed answer keys cannot publish.

`npm run check` runs lint, all gateway/UI regression tests and the production build. The new integration suite applies real SQL migrations to a synthetic PostgreSQL engine, checks account/source/job isolation, idempotency, quotas, fenced publication, final-attempt recovery, checkpoints, central cache reuse across 50 accounts, preparation ownership handoff and encrypted backup/restore. Python tests cover transcript tail preservation, complete section coverage, Arabic lexical retrieval, source-only unknown answers, citation rejection, quiz coverage and checkpoint resume. CI runs both suites without external AI calls.

These deterministic tests establish behavior; they are not a model-quality benchmark or a proof of production capacity. Before opening access broadly, evaluate a representative Arabic/English lecture set with manually reviewed grounded answers, unsupported questions, injection attempts and quiz correctness. Measure generation time, queue age, memory, storage growth and multiple concurrent source preparations on the actual processing hardware. Deploy learning migrations and worker connectivity independently of the original chatbot repository.

Primary implementation references: [PostgreSQL locking clauses](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE), [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs), and [the multilingual E5-small model card](https://huggingface.co/intfloat/multilingual-e5-small).
