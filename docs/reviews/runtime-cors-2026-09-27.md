# Login and registration-course runtime investigation — 2026-09-27

## 1. Architecture

React/Vite and an Axios client call an Express API on Vercel. The API uses Render PostgreSQL, bcrypt and JWTs, without Supabase or an external authentication provider. Account and course queries use the same database pool. Render also contains older frontend/backend services, but the observed Vercel frontend does not call those hosts.

## 2. Login request

`Auth.jsx` → `AuthContext.login` → `POST /api/auth/login` → `backend/src/routes/auth.js`. Application users are looked up in `app_users`; numeric student IDs fall back to `students`. JWTs are issued only after credential verification. Refresh uses `authService.me` → `GET /api/auth/me` → `authenticate`, which reloads the correct account and resolves its role. Both roles use the same API host, form and transport.

At 12:46 UTC, the browser on `https://edufusion-frontend-git-codex-fix-student-login-nizar9.vercel.app/login` failed against `https://edufusion-backend.vercel.app/api/auth/login`. Console evidence: the preflight response had no `Access-Control-Allow-Origin`. The browser blocked POST before authentication ran. The test used a nonexistent numeric username and an invalid probe password, not real credentials.

## 3. Courses request

`Auth.jsx` → `authService.registrationCourses` → `GET /api/auth/registration-courses` → `listRegisterableCoursePresentations`. This public endpoint does not require a token or a student role. Its query joins `course_presentations`, `academic_clocks`, and `assessments`; it returns courses that have a clock and at least one assessment.

The browser on the same branch frontend reported `net::ERR_FAILED`, with the explicit CORS error that `Access-Control-Allow-Origin` was missing. Direct HTTP returned 200 and 22 real courses. The frontend catch converted the transport failure into `coursesFailed`; an empty course list also sets that flag. The friendly "API may still be waking up" text was not evidence of a sleeping service.

## 4. Root cause

Production and preview frontends both had `VITE_API_URL=https://edufusion-backend.vercel.app/api`. Production and preview backends both had only `FRONTEND_URL=https://edufusion-frontend-nizar9.vercel.app`. The existing CORS middleware allowed that exact origin and localhost, excluding both the branch preview alias and individual preview deployment URL.

The browser origin was therefore incompatible with the API allowlist. An OPTIONS request returned 204 but lacked permission headers for the branch origin; 204 alone does not establish CORS success. No new database failure was found: health, readiness and course queries returned 200, and direct invalid login returned the expected 401. API root `/` returned the expected Express 404 because no root handler exists.

## 5. Shared failure?

Yes, both failures reproduced on the branch preview shared this CORS mismatch against the same backend host. Courses reached the API, but the browser could not read the 200 response. Login failed its preflight before credentials were processed.

The canonical production frontend was separately checked in a browser: all 22 courses loaded without console errors. This distinction matters: the older student-only 503 was the missing `pin_format` migration repaired earlier, not the cause of the new preview-wide browser failure.

## 6. Why admin previously worked

The original database defect affected only the student query; admins used an intact `app_users` table. The current CORS defect is role-independent and blocks admin and student requests alike from an untrusted origin. Admin success from the canonical production origin does not establish that a preview origin works.

Production frontend and backend both ran commit `dc190766d6a5459c90b1405309a2cdf40a250515`; the initially failing branch preview ran `d7f0c9e8dae48380a5f366e03a6b79546b1db9fe`. The auth/course endpoints and response contracts were compatible across those versions. Environment routing and origin drift, not a missing course route, explained the failure.

## 7. Fix applied

Preserve the existing canonical origin setting and support an additional explicit `FRONTEND_URLS` allowlist. Validate HTTP(S) origins and reject paths, embedded credentials and wildcards. Log blocked origins without request bodies, headers or tokens. Course lookup exceptions now use the existing safe account diagnostics. Axios diagnostics classify network/CORS, timeout, authorization, service unavailable, server and request errors without dumping sensitive Axios error objects. User-facing design and auth/role checks remain unchanged.

## 8. Files changed in this follow-up

- `backend/src/lib/corsOrigins.js`: validated exact origins and safe rejection diagnostics.
- `backend/src/app.js`: use the configured CORS options.
- `backend/src/config.js`: validate origin configuration during startup.
- `backend/.env.example`: document `FRONTEND_URLS`.
- `backend/src/routes/auth.js`: safe course-query failure diagnostics.
- `backend/test/cors.test.js`: allow trusted origins/preflight; reject other previews, lookalikes and opaque origins.
- `backend/test/platform.test.js`: public/authenticated course listing and registration-to-session integration.
- `frontend/src/services/apiDiagnostics.js`: safe transport/status classification.
- `frontend/src/services/api.js`: invoke diagnostics without changing error propagation.
- `frontend/src/test/apiDiagnostics.test.js`: classification and secret-omission regression.
- `README.md` and this report: preview configuration and evidence.

## 9. Deployment/configuration changes

Vercel frontend settings are scoped to Preview and branch `codex/fix-student-login`; the public production backend was redeployed with the verified code and explicit origin allowlist:

- Frontend `VITE_API_URL` remains `https://edufusion-backend.vercel.app/api`. The backend branch preview initially redirected unauthenticated requests to Vercel login, so it was not used as the public API; deployment protection remains enabled.
- Production backend `FRONTEND_URLS` explicitly allows the stable frontend branch origin, the known main-branch frontend alias, and verified individual frontend deployment origins used for testing. Canonical `FRONTEND_URL` remains unchanged. The same branch-scoped additional-origin setting exists on the backend preview.

The production backend deployed commit `8eddc9427d5fb88ba153d5410d0ebc4b9d604537` from the requested branch; the production frontend remains unchanged. Merge PR #6 into main to retain these fixes in subsequent main deployments. No production data changes, new migrations, database resets, Render plan changes or Supabase settings are required. Existing preview database settings were retained; this is not a new isolated database. Future unrelated previews need their own explicitly trusted origins/configuration. Use the stable branch URL for ongoing testing.

## 10. Verification

`npm run check` passed: ESLint, 52 backend tests, 27 frontend tests and production build. This JavaScript repository has no separate typecheck command. Existing auth regressions cover valid/invalid student credentials, absent accounts, admin authentication, session restoration, role protection and logout. New integration coverage verifies course listing before/after authentication and registration producing a usable student token and enrollment. No real production account was created for verification.

Before deployment, browser traces independently confirmed canonical production courses 200 and preview courses/login blocked by CORS. After production backend deployment, the branch browser loaded courses with HTTP 200 and no CORS errors; its invalid login reached the API and returned the intended 401 with the visible Invalid credentials message. Both canonical and branch origins receive exact CORS permission headers; an untrusted origin receives none. Health/readiness both return 200. An isolated real-browser registration returned 201, loaded the student dashboard, and restored the session on refresh (/auth/me 200). GitHub CI and final preview results are recorded in the PR.

## 11. Remaining issues

The user previously chose to perform valid live student/admin credential checks personally; isolated accounts cover that behavior here. The Render database's reported October 1 expiry still requires separate lifecycle attention. Historical chatbot provider errors are outside this auth/course correction. The user's exact failing URL was requested; the branch-preview failure described above was independently reproduced without needing that answer.
