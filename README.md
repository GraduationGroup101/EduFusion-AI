# EduFusion AI

EduFusion brings education tools into one authenticated dashboard: academic-risk prediction (EduPredict), university chat, YouTube transcription (LectureScribe), document-based question generation (Quiz Generator), and adaptive voice practice (Oral Exam).

The React frontend talks only to an Express gateway. The gateway authenticates users with PostgreSQL/JWT and calls the external AI services. Model training, retrieval, transcription, and question-generation implementations live outside this repository.

## Development

Use Node **22.13+** or **24+**. Install from the committed lockfiles:

```sh
npm run install:all
```

Copy `backend/.env.example` to `backend/.env`, and set your PostgreSQL URL and a unique JWT secret of at least 32 characters. Generate one with:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

For a local PostgreSQL instance without TLS, set `DB_SSL=false`. Remote connections verify certificates by default. Provide `DB_SSL_CA` when the server uses a private CA; connection-string `sslmode` flags do not override gateway verification policy.

Apply migrations before starting the backend:

```sh
npm run migrate --prefix backend
```

To create a demo course and administrator in a **development** database, set `DEMO_ADMIN_PASSWORD` and run:

```sh
npm run seed --prefix backend
```

The demo administrator username is `demo-admin`. No default password is committed. The seed does not replace existing users or credentials. It is blocked in production.

Start the services in separate terminals:

```sh
npm run dev:backend
npm run dev:frontend
```

Frontend: `http://localhost:3000`; backend: `http://localhost:5000`. Vite proxies `/api` to the backend. The frontend defaults to `/api`; copy `frontend/.env.example` if you need a different gateway URL.

## Checks

```sh
npm run check
npm audit --prefix backend
npm audit --prefix frontend
```

`check` runs ESLint, backend regression/integration tests, frontend tests, and the production build. Backend integration tests run the actual migrations and queries in an isolated PostgreSQL engine (PGlite); they do not use your configured database or contact external AI services. API providers are mocked for reproducible contract tests.

CI runs these checks on pull requests and on `main`, plus production dependency audits. Production dependencies, development tools and lockfiles are updated together.

## Accounts and data boundaries

Administrators and advisors authenticate through `app_users`; students through `students`. Both paths hash credentials with bcryptjs. Legacy plaintext student PINs are upgraded after a successful login using a conditional update. `pin_format` records credential provenance, preserving old character PINs that resemble hash prefixes while rejecting malformed values marked hashed. Longer legacy secrets use a versioned SHA-256 preprocessing format to avoid bcrypt's 72-byte truncation; new PINs are limited to 72 UTF-8 bytes. A recognized stored hash can never be used as a plaintext password. Invalid Unicode credentials are rejected before hashing.

The student prediction page separates **actual academic evidence** from **what-if scenarios**. Saving a scenario never modifies grades, submission dates, VLE events, or the real prediction history. The gateway evaluates a saved scenario through EduPredict's `/students/{id_student}/scenario-prediction` endpoint, which applies the simulated activity and assessment changes to an in-memory copy of the student's raw evidence before using the same feature engineering and model as the actual prediction. The hypothetical result is displayed separately and is never written to the actual prediction cache.

Students build a scenario from plain-language presets ("a little more" study, "try a different score", "on time") with a Custom option for exact values; raw model fields are never shown. Each saved scenario stores a snapshot of the evidence it was built on, and the gateway reports whether it is `current`, `needs_reevaluation`, `stale` (the course day moved) or `invalid` (a referenced assessment no longer applies). Stale and invalid scenarios are never evaluated. Students can delete their own scenario, which removes only the isolated row, or keep it as a personal learning plan. There is deliberately no "save scenario as actual" for students: the shared academic tables are source-of-truth records and no student-facing path writes to them. See [the What-if review](docs/reviews/edupredict-whatif-2026-09-30.md).

Chat history is persisted in PostgreSQL with 24-hour expiry, per-owner session/message caps, and separate namespaces for student and application accounts. Lecture jobs are accessible only to accounts that created them through EduFusion. Historical jobs from the provider's previously global list are not automatically assigned to a user. Cached job reuse grants access only after a successful authenticated creation request, without overwriting another owner's entitlement.

Clock commands require an idempotency key. A request replay cannot move time twice. A prediction-regeneration outage after a clock update is returned as a warning; the committed clock change is not reported as a failed operation.

See [the API contracts](docs/api-contracts.md) for payloads, limits, error semantics and provider behavior.

## Deployment and upgrade order

1. Back up the shared database and confirm the target database URL. `001_core.sql` bootstraps a fresh development database and retains existing tables; it is not an authoritative replacement for an external EduPredict model's schema. On an existing database, review the consumed columns and added indexes before running migrations.
2. Set a strong `JWT_SECRET`, `FRONTEND_URL`, provider URLs and `ADMIN_API_KEY` on the backend. Set `DB_SSL=true` for the remote database, and configure a trusted CA when required. Backend startup rejects missing or malformed essential settings. Vercel/Render default to one trusted proxy hop; `TRUST_PROXY` overrides this with an explicit hop count.
3. Run `npm run migrate --prefix backend`. The migration widens legacy PIN columns to TEXT and creates gateway-owned history, scenarios, job entitlements and clock-command tables. Migrations use one transaction, an advisory lock and a migration ledger. They do not edit existing grades or prediction records.
4. Run `npm run migrate:pins --prefix backend` to hash remaining legacy PINs before switching application traffic. Login also upgrades an untouched legacy account safely. The bulk command never prints credentials and does not overwrite concurrent resets. Investigate malformed hash-looking values through an explicit credential reset.
5. Deploy the backend on Node 22.13+ or 24+. `/api/health` checks process liveness; `/api/ready` checks database/migration availability. Direct Express startup has graceful shutdown; Vercel can import the exported app. Hosting must allow up to 80 seconds for prediction/chat and 170 seconds for question generation. If the hosting plan cannot support that, the provider must offer a job API rather than increasing browser timeouts indefinitely.
6. Set Vercel's frontend **Root Directory** to `frontend` and `VITE_API_URL` to the deployed backend's `/api` URL. `frontend/vercel.json` serves `index.html` for client-side routes.
7. Verify login for an upgraded student and an administrator, owned job/transcript access, scenario isolation, uploads, and `/api/ready` against the deployed environment. Local mock-provider tests do not prove current provider availability.
8. Configure daily cleanup using the workflow below, then protect `main` after the `verify` CI check appears. The repository includes `scripts/configure-branch-protection.ps1` for administrators authenticated with `gh`; it requires one approval, an up-to-date passing `verify` check, resolved conversations, and prohibits force pushes and branch deletion.

**Rollback:** keep the new gateway tables and wider PIN column. Reverting to an old backend that expects plaintext student PINs will break migrated accounts; roll forward with the compatible verifier. Keep source academic records and newly hashed credentials intact. Do not run a destructive down-migration to recover from a deployment problem.

**Student login returns 503 while admin login works:** check backend logs for `42703` and `student_account_lookup`. The student query requires `students.pin_format` from `004_pin_format.sql`; admins use `app_users` and do not need that column. Back up and confirm the deployed database, then apply the existing migration command above. Do not remove the column from the query or fall back to unmarked plaintext credentials. Gate releases on `/api/ready`, which checks every bundled migration and the actual student credential columns; `/api/health` is only a process check. See [the September 2026 investigation](docs/reviews/student-login-2026-09-27.md).

**Login and registration courses both fail only in a browser preview:** compare the browser origin, built `VITE_API_URL`, and API CORS headers. `FRONTEND_URL` retains the canonical frontend origin; optional `FRONTEND_URLS` adds a comma-separated list of exact trusted origins. Do not allow all Vercel domains. For a branch preview, point its `VITE_API_URL` to the intended browser-accessible gateway `/api` URL and allow its stable frontend branch origin on that gateway. A Vercel-protected backend preview is not a public API: keep deployment protection enabled and use the public gateway with explicit trusted origins. If using an individual deployment URL, add that exact trusted origin too. Environment changes require rebuilding the frontend or redeploying the backend. Preview databases/credentials are separately configured; changing the API URL alone does not isolate the database. See [the runtime/CORS investigation](docs/reviews/runtime-cors-2026-09-27.md).

## Maintenance

The [Oral Exam integration](docs/oral-exam.md) documents source selection, the fixed ten-minute session, private transcripts and feedback, voice-provider configuration, and the live PR #10 Render deployment. The replacement Render PostgreSQL database has been restored and migrated through 005; provider credentials remain server-side and never reach the browser. PR #10 remains unmerged, and physical microphone browser verification remains manual.

The lecture page's independent library, lecture-scoped chat/practice, durable local worker, ownership rules and separate database setup are documented in [Lecture study integration](docs/lecture-study-integration.md). Enable it with `LECTURE_STUDY_ENABLED` only after configuring and migrating `LEARNING_DATABASE_URL`. The original chatbot and general question-generator pages retain their current behavior.

**Hosted lecture tools.** Without the local library, a completed transcript still offers "Ask this lecture", "Generate questions" and "Oral exam on this lecture" on any backend that has `GROQ_API_KEY` (the Render backend in production; set `VITE_LECTURE_TOOLS_API_URL` or reuse `VITE_ORAL_EXAM_API_URL` so the browser reaches it). Transcription uses `LECTURESCRIBE_API_URL` (`https://lecturescribe-ai.onrender.com`). Finished transcripts are stored in the shared database (`006_lecture_tools.sql`, `012_lecture_library.sql`) as soon as the gateway observes them: when a page polls, when the list refreshes, when LectureScribe calls back (`LECTURESCRIBE_CALLBACK_URL`; requires `LECTURESCRIBE_GATEWAY_KEY`, which production must set), or with `npm run lectures:sync --prefix backend`. A student who submits a lecture already stored in a compatible language and mode receives it instantly. Each student sees only their own lectures, and administrators see all of them with who saved each one. Signing in wakes the sleeping transcription, chatbot, question-generator and prediction services. See [the API contracts](docs/api-contracts.md).

```sh
npm run cleanup --prefix backend
```

This removes expired chat rows and clock commands older than 30 days. `.github/workflows/database-maintenance.yml` runs it daily when the repository variable `ENABLE_DATABASE_MAINTENANCE=true` and Actions secret `DATABASE_URL` are configured. It can also be started manually. Actions needs the externally reachable database URL; an internal Render URL works only from the same private network.

The separate Render keep-alive workflow is opt-in through `ENABLE_RENDER_KEEP_ALIVE=true`; it only checks selected services and PostgreSQL. Its lecture reconciliation job (`npm run lectures:sync`) is opted into separately with `ENABLE_LECTURE_SYNC=true` and the `DATABASE_URL` secret; it settles lost lecture jobs but cannot replace LectureScribe's completion callbacks, which need `LECTURESCRIBE_GATEWAY_KEY` on the backend. Sleeping free services and hosting time limits remain infrastructure constraints. Enable the optional workflow only after considering the hosting plan's usage budget.

## Database and source layout

```text
backend/
  migrations/              Fresh-schema bootstrap and gateway upgrade migrations
  scripts/                 Migrate, upgrade PINs, seed, cleanup, keep-alive
  src/app.js               Express app, routes, liveness/readiness
  src/index.js             Validated startup and graceful shutdown
  src/db/                  SQL reads, transactions, history, jobs, scenarios, clocks
  src/lib/                 Credential compatibility, validation, provider requests
  src/middleware/          Authentication, roles and request limits
  src/routes/              Gateway API
  test/                    Regression and isolated PostgreSQL integration tests
frontend/
  src/context/             Session bootstrap
  src/services/api.js      Gateway client and safe clock retries
  src/pages/               Lazy-loaded tools and role-specific dashboards
  src/test/                Access and session regression tests
  public/                  Landing-page video assets
```

Shared academic tables: `app_users`, `students`, `enrollments`, `course_presentations`, `academic_clocks`, `assessments`, `student_assessments`, `vle_sites`, `student_vle_events`, `predictions`.

Gateway-owned tables: `edufusion_schema_migrations`, `edufusion_chat_history`, `edufusion_lecture_jobs`, `edufusion_lecture_transcripts`, `edufusion_lecture_quizzes`, `edufusion_student_scenarios`, `edufusion_clock_commands`, `edufusion_oral_exam_sessions`, `edufusion_oral_exam_turns`.

The two MP4 files at repository root are source assets. The web application serves the processed files in `frontend/public`; keep source assets outside the delivery bundle.
