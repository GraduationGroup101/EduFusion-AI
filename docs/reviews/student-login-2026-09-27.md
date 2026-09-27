# Student authentication investigation — 2026-09-27

## 1. Project architecture

React 18, Vite and React Router serve the frontend. Axios talks to an Express gateway using `VITE_API_URL`. PostgreSQL is accessed through parameterized `pg` queries, without an ORM or external identity provider. The deployed frontend and gateway use Vercel; the shared academic database is Render PostgreSQL. Older Render frontend/backend services also exist. AI services are separate and are not called during login.

`DATABASE_URL`, `DB_SSL`/`DB_SSL_CA`, `JWT_SECRET`, `FRONTEND_URL`, and frontend `VITE_API_URL` are the relevant settings. Database TLS certificate verification remains enabled. No environment values were changed.

## 2. Login flow

The common form in `frontend/src/pages/Auth.jsx` invokes `AuthContext.login`, which posts username/password to `/api/auth/login`. The gateway first searches `app_users`. If no application user matches and the username is a valid positive integer, it queries `students`.

Admins/advisors verify `app_users.password_hash` with bcrypt and enforce `is_active`. Students verify `students.pin_hash` using explicit `pin_format` provenance; a valid legacy PIN is conditionally upgraded without overwriting concurrent credential changes. The route creates a 24-hour JWT only after verification. Student tokens contain `id_student`; application tokens contain `id`. Both include username and role.

The client persists the token and user, attaches a Bearer header, and redirects to `/dashboard` or the requested protected route. Refresh calls `/api/auth/me`; middleware reloads the account from `students` or `app_users` and derives its role from the database path. Student dashboard data comes from `/api/dashboard/student-summary`; admin aggregate routes require admin/advisor. There is no separate external profile service in this path. Frontend logout clears local session data; JWTs otherwise retain their existing 24-hour lifetime.

## 3. Root cause and evidence

Production code was deployed without the existing gateway migrations. `findStudentById` selects `id_student, student_name, pin_hash, pin_format`; the production `students` table lacked `pin_format`, and the database had no `edufusion_schema_migrations` ledger or gateway-owned tables.

Vercel production deployment `dpl_3H4rAPxHHkKEcCMH6FvueDUD9wiH` (commit `dc190766d6a5459c90b1405309a2cdf40a250515`) logged at 11:56:20 and 11:58:57 UTC:

```text
POST /api/auth/login 503
Login error: error: column "pin_format" does not exist
code: 42703
at findStudentById (/var/task/backend/src/db/queries.js:13:18)
at /var/task/backend/src/routes/auth.js:42:25
```

The exception was already retained in backend logs; the frontend received the generic fallback. The two sources of that fallback are `backend/src/routes/auth.js` and `backend/src/middleware/auth.js`. This incident was in the login route, before credential verification, token creation, profile/session lookup or dashboard loading.

Render read-only schema inspection independently confirmed the missing column. An invalid numeric login probe reproduced 503 without requiring anyone's credentials. `/api/ready` also returned 503. All 28,797 students had enrollment records, so a missing enrollment was not the cause. Student roles are constructed as lowercase `student`; no role mismatch or separate student API URL explained the failure.

## 4. Why admin was unaffected

An existing admin is found in `app_users` and never executes the student query. Its table and credential fields existed. The isolated reproduction verified admin login 200 in the same database state where student login returned 503. Live successful admin credentials were not exercised by the investigator.

| Step | Admin in isolated reproduction | Student before migration | Student after migration |
|---|---|---|---|
| Account query | Success | 42703, missing column | Success |
| Credential verification | Success | Not reached | Success |
| JWT issued | Yes | No | Yes |
| `/auth/me` and dashboard | Success | No session created | Success |
| Role | admin | Not reached | student |
| Browser redirect and refresh | Success | Login blocked | Success |

## 5. Files changed

- `backend/src/db/readiness.js`: verify all bundled migration names and the live student credential columns, including `pin_format`.
- `backend/src/app.js`: use the stronger readiness check and emit server-side diagnostics for failures.
- `backend/src/lib/accountError.js`: shared diagnostics with stage, error code, safe schema/migration messages and stack frames; omit credentials, request bodies and database row details.
- `backend/src/routes/auth.js`: identify the failing login stage; keep internal exception details out of client responses in all environments.
- `backend/src/middleware/auth.js`: distinguish student and application session lookup failures in logs.
- `backend/test/authMigration.test.js`: reproduce the exact pre-migration failure, verify the existing migration repair and both account flows, test readiness drift and diagnostic privacy.
- `README.md`: explain diagnosis, safe remediation and readiness gating.
- This report: record evidence, validation and deployment status.

No login verification, role policy, UI, credential value or existing migration SQL was changed.

## 6. Fix

The operational fix was applying existing migrations `001_core.sql` through `004_pin_format.sql` to the confirmed production `edufusion_db`. A full PostgreSQL custom-format backup was created and its archive inventory verified first, using verified TLS and a local directory restricted to the current Windows user. Backup size: 1,042,799 bytes. It is outside the repository at `%LOCALAPPDATA%/Temp/edufusion-auth-repair-20260927/before-migrations-verified.dump`.

The existing migration runner used its transaction, advisory lock and ledger. Additional bounded lock/statement timeouts protected this repair. Before committing, fingerprints of all existing rows in the 10 shared tables were compared inside the transaction, excluding only the newly added `pin_format` field. All existing credential values and academic records matched exactly. Migration 004 marked existing student credentials with legacy provenance; their actual PIN values were not rewritten by the repair. Valid legacy login continues to perform the existing safe bcrypt upgrade.

The source changes add detection and diagnostics; the production database repair does not depend on their deployment.

## 7. Verification

- `node --test test/authMigration.test.js` from `backend`: 3/3 passed. Actual PGlite PostgreSQL errors reproduce the missing column; migrations are applied twice to check idempotency.
- `npm run check`: ESLint passed; 48 backend tests passed; 26 frontend tests passed; production build passed. There is no separate type-check command in this JavaScript repository.
- Authentication coverage includes valid legacy/new student PINs, invalid password, nonexistent account, repeated session restoration, student dashboard, admin login/dashboard, role-protected routes, logout API, unauthenticated access, malformed hashes, long/Unicode PINs from the existing suite.
- Playwright CLI against the built frontend and actual Express gateway backed by isolated PGlite: student login and dashboard 200, refresh `/auth/me` 200, admin-route redirect for student, student logout and protected-route redirect, admin login/dashboard and academic-clock access 200, admin logout and signed-out protected-route redirect. Browser console reported zero errors or warnings. External AI services were disabled for this fixture.
- Production before repair: numeric invalid login 503 and readiness 503. After repair: the same login returns 401 `Invalid credentials`, readiness returns 200 `ready`, and login CORS permits the configured frontend origin.
- Render read-only query after repair confirms all four migration ledger entries.

The user chose to perform valid live student/admin credential checks personally. No production account was created, no production password was reset, and no production session was forged for verification.

## 8. Remaining risks

Valid production credentials still need the user's final check. Local provider mocks do not prove live AI service availability. The existing stateless JWT logout behavior was preserved. Bulk legacy PIN migration remains an existing maintenance option, separate from this repair.

Render reports the free `edufusion-db` instance expires on **2026-10-01**. Address that database lifecycle before the expiry to prevent a separate service outage; this investigation made no billing/plan changes.

## 9. Deployment/configuration actions

The required production database migration is complete. No new environment variable, credential, Vercel API URL, Supabase setting, or additional migration is needed for this incident. Supabase is not used here.

Merge/deploy the accompanying source changes to activate stronger readiness diagnostics. Future releases must run reviewed migrations against the exact deployed database before switching traffic and require `/api/ready` to return 200. Do not run production migrations from preview builds. Retain the verified backup securely through the recovery window; avoid restoring it over legitimate subsequent writes.
