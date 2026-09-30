# Oral Exam connection reliability — 2026-09-30

## Result and limits

The single-browser recovery failure is reproduced: after a transport interruption, the still-live server socket renews its lease while replacement sockets are rejected as “connected elsewhere.” The six browser retries can finish before the old socket's pong watchdog releases the lease. This patch fixes that recovery race without admitting a second browser as an owner.

**The initial production interruption remains unproven.** Historical EduFusion deployment logs and hosting settings were unavailable through the connected Render/Vercel accounts. The connected Render workspace contains an unrelated suspended chatbot, not `edufusion-backend`. Fault injection demonstrates the recovery defect; it does not prove what dropped the user's initial connection around minute four. Production verification is still required. Nothing was deployed or merged by this investigation.

Started from fetched `origin/main` at `7b01b7535285f6e94198e69769ad7c97183c5711` on `codex/oral-exam-connection-reliability`.

## 1. Reproduction

Used the real React page, audio worklet, Express routes, JWT authentication, WebSockets, migrations and SQL through an isolated PGlite database. Chrome used a synthetic microphone; STT/model/TTS were deterministic fixture implementations. No production account, student speech, provider credentials or paid provider request was used.

The unmodified baseline stayed connected for **8 minutes 24 seconds** on September 29, 21:41:26–21:49:50 UTC. One socket open, no close/error, 1:36 remaining. The fast fixture reached question 143 because it bypasses the production model's 30-turn policy; this checks transport/timing, not pedagogical quality or provider lifetime. No fixed four-minute cutoff was reproduced without a fault.

The fault proxy then dropped its browser-side transport at four minutes, retaining the upstream socket and suppressing pong forwarding. The comparison fixture used the **old lease acquisition policy** (`ORAL_EXAM_FIXTURE_LEGACY_CLAIM=true`) with the same controlled gateway and diagnostic runtime. It was not an exact deployed-stack replay.

Session: `a5c5dcd6-6c8d-4da8-a744-909fd1528ff2`. Stored start/expiry: `23:25:56.927` / `23:35:56.927` UTC, September 29.

| Timestamp (UTC) | Observation |
| --- | --- |
| 23:29:57.412 | Deliberate browser transport drop at about 4:00 |
| 23:29:57.418 | Browser close 1006 |
| 23:29:58.475–23:30:26.152 | Six retries receive the exact reported text, then close 4429 |
| 23:30:22.370 | Old socket renews a 20-second lease; pong age 25,045 ms |
| 23:30:26.161 | Browser exhausts retries |
| 23:30:27.366–.372 | Server detects pong age 30,041 ms and releases the old lease, about 1.2 seconds after the final retry |

Only one browser participated. Ownership sampling showed one server client/held lease during refused retries, then zero after cleanup. The exam remained active with its original deadline. No LectureScribe failure was needed.

## 2. Confirmed cause and related defects

The text originates in the `realtime.js` handshake catch: a `store.claim()` 409 becomes that text plus close 4429. Previously, acquisition required a null/expired lease and could not distinguish reconnect from another tab. The server renewed the orphan's lease every five seconds until its 30-second pong watchdog fired. The browser's six delays total 27.25 seconds before jitter and request time, so recovery can terminate before orphan cleanup.

Inspection and regression tests also exposed:

- An expired lease was classified as permanent ownership conflict (4409) whenever the exam was active, without checking for a different live token.
- The client watchdog waited for close acknowledgement before reconnecting; an unfinished close handshake could stall recovery.
- Late old-socket events could stop new audio/watchdogs and overwrite connection state.
- A snapshot read before acquiring ownership could miss a completed old turn.
- Delayed HTTP refresh could increase the displayed timer or resurrect active state after the exam ended.
- Socket finish needed the same rotating token fence as turn writes to prevent an old instance ending a newer owner's exam.

These are demonstrated lifecycle defects. None establishes why production lost its initial transport.

## 3. Runtime and timeout trace

The documented architecture has a Vercel frontend/general API and Render Express backend for Oral Exam HTTP/WebSockets, using existing authentication/database. On September 29 at 21:43 UTC, the served frontend bundle explicitly targeted `https://edufusion-backend.onrender.com/api` for Oral Exam. Read-only checks returned 200 from the public frontend, both backend health endpoints, Render readiness and `lecturescribe-ai.onrender.com/health`. Point-in-time health does not explain a historical 502. The current deployed commit, instance plan, function settings and restart history were unavailable.

| Layer | Existing value / observation |
| --- | --- |
| Exam | 600 seconds, fixed in PostgreSQL at start; reconnect never changes it |
| Lease | 20 seconds; renewal every 5 seconds |
| Server pong watchdog | More than 30 seconds without pong, checked on the 5-second heartbeat |
| Client message watchdog | 20 seconds |
| Client retries | Six; 750/1,500/3,000/6,000/8,000/8,000 ms plus 0–300 ms jitter |
| Server hello frame | 10 seconds |
| STT | 8-second provider handshake; 10-second session-start deadline; no application four-minute session timeout |
| TTS | 20-second request/body deadline |
| Groq | Up to 25 seconds per attempt, capped by remaining exam time; at most two attempts with 150 ms retry delay |
| Playback acknowledgement | 60 seconds |
| Express HTTP request timeout | 30 seconds; no four-minute setting in the entrypoint |
| Active HTTP refresh | 10 seconds after each completed request; single flight after this patch |
| General Axios request | 90 seconds; auth probe overrides to 10 seconds |
| JWT | 24 hours at issuance; socket enforces the actual token expiry |
| LectureScribe health proxy | 15 seconds, including upstream body |
| Other upstream default | 80 seconds; health route overrides it |
| Hosting/gateway/provider lifetime | No production configuration/log evidence; do not infer a numerical limit |

No timeout was extended. [Render's WebSocket documentation](https://render.com/docs/websocket) states there is no fixed platform maximum duration and discusses interruptions across instance lifecycles. This is context, not evidence of a Render incident in this exam.

## 4. LectureScribe 502

`GET /api/lecture-scribe/health` proxies the transcription service's `/health`. It can propagate an upstream 502, convert provider 401/403 to 502, or return 502 for invalid JSON/body-limit failure. Historical response/logs are needed to distinguish them. A plain configured deadline abort maps to 504; a 502 alone does not prove a timeout.

The LectureScribe page checks health on mount/manual retry. Oral Exam does not poll that endpoint. Auth warm-up is a separate `/api/services/warm-up` request. Active exams use their saved source snapshot, ElevenLabs and Groq, without LectureScribe calls per question.

The shared Axios interceptor clears credentials on user-session 401, not 502. The health handler has no exam status/lease mutation. Regression tests demonstrate isolation. API warnings now include a whitelisted service label while retaining the HTTP failure. This patch does not silence failures or claim to repair an unobserved LectureScribe outage.

## 5. Connection lifecycle after the patch

Each mounted exam page creates a private UUID capability kept only in memory. It survives retries and a lost welcome. Another mounted page/tab has a different capability. It goes in the authenticated first frame, never a URL, log, public response or browser storage.

Migration 007 adds `lease_client_id`. An atomic owner-scoped claim allows a free/expired lease or the same capability, then rotates the separate server-only write token. A second tab cannot take a live lease. The previous local socket is disposed immediately and providers aborted. Database tokens fence other instances, including turn/finish writes; stale release cannot erase a newer lease. The saved snapshot is reread after fencing.

The client detaches the failed socket immediately, schedules one bounded retry loop and ignores older socket/generation callbacks. Its watchdog reconnects without waiting for close acknowledgement. Real ownership/authentication closes remain terminal; expiry without another live owner is retryable. The original clock remains fixed; cancellable/single-flight polling cannot resurrect terminal state.

Partial speech is discarded on interruption. Completed transcripts/assessments remain; a saved unassessed answer resumes processing. An unfinished examiner question can replay once after recovery, without adding another saved question or examiner owner.

Diagnostics contain session/socket UUIDs, timestamps, close code/known reason, retries, lease/watchdog timing, auth seconds remaining and provider failure stage. Heartbeat detail requires `ORAL_EXAM_DIAGNOSTICS=true`. Capabilities, write tokens, JWTs, audio, transcripts and raw provider payloads are excluded.

## 6. Files changed

- Backend: `migrations/007_oral_exam_connection.sql`, `src/oralExam/{store,realtime,diagnostics}.js`, `src/db/readiness.js`.
- Frontend: `src/hooks/useOralExamVoice.js`, `src/pages/OralExamPage.jsx`, `src/services/{oralExam,oralExamDiagnostics,apiDiagnostics}.js`.
- Tests: new backend lifecycle/diagnostics and frontend voice suites; expanded page/API tests; existing migration-count expectations.
- Local verification: extended `scripts/verifyOralExam.js`, new `scripts/verifyOralExamProxy.js`. Both refuse non-test mode, bind localhost and are absent from deployed imports.
- Documentation: this record and `docs/oral-exam.md` connection/migration guidance.

## 7. Automated verification

New regressions failed against the prior implementation before the fixes. Final backend: **97 passed**, 0 failed. Final frontend: **60 passed in 13 files**, 0 failed (`--maxWorkers=1`). Coverage includes eight-minute fake-clock operation, network/server closes, orphan sockets, lost welcome, second-tab rejection, rapid reconnect, fresh server instance recovery, token-fenced release/finish, saved-turn rehydration, duplicate/late STT callbacks, fixed expiry, delayed/aborted polling, auth expiration and unrelated health 502.

Final lint and `git diff --check` passed. The production Vite build passed in 6.42 seconds. There is no separate TypeScript typecheck. Deterministic fixtures do not evaluate provider/model quality.

[GitHub CI run 48](https://github.com/GraduationGroup101/EduFusion-AI/actions/runs/36685631341) also passed against the PR candidate combined with newer `main` commit `b9876cc`: 99 backend tests, 81 frontend tests, lint/build, 11 lecture-engine Python tests and both production dependency audits (zero vulnerabilities). Those higher counts include the intervening What-if feature tests. This was GitHub's temporary test candidate; the PR and `main` were not merged by this task.

## 8. Long-duration verification after the fix

The fixed browser run completed the full **ten-minute deadline**, September 30, 07:30:53.340–07:40:53.340 UTC (10:30:53–10:40:53 Cairo). Session: `321defc3-a067-4290-8799-68fd7cbeecd2`. It used the slower answer fixture, a drop at four minutes and a browser-intercepted LectureScribe 502 every 15 seconds through the real Axios service. These are local conditions, not production events.

| Timestamp (UTC) | Observation |
| --- | --- |
| 07:34:53.454–.460 | Deliberate network interruption; original browser socket closes 1006 |
| 07:34:54.437 | First reconnect receives welcome, about 0.98 seconds after interruption |
| 07:34:54.440 | Old upstream socket closes 4001 after immediate disposal; its release does not clear the new token |
| 07:39:08.975 | At 8:15 elapsed: still active, question 16, 15 completed/assessed turns, timer 1:45, one server client, two total browser opens, no exam errors, auth retained despite 33 health failures |
| 07:40:25.702–.704 | A separate real browser tab is rejected with ownership conflict/4429 and receives no welcome; the original connection continues |
| 07:40:53.356 | Browser deadline closes the socket 16 ms after stored expiry (1005 because the browser sends no explicit close status); active exam controls disappear |
| 07:41:19.945 | Final snapshot: `timed_out`, same original expiry, no lease/client key, zero server clients, 18 answered/assessed turns and one unanswered question, unique contiguous sequences 1–19, no primary-tab exam errors |

All accepted answers were preserved through recovery. The question active during the interruption replayed without adding a persisted turn. Health failure count was 41 at the final snapshot, including one after expiry. This proves the local recovery/timer/HTTP isolation path with real elapsed time. It does not test paid provider lifetime, hosting restarts or a physical microphone, and it is not production verification.

The committed [compact evidence record](evidence/oral-exam-reliability-2026-09-30.json) contains the before/after close sequences, ownership lifecycle and checked deadline/turn counts. Safe raw artifacts remain under local `output/playwright/`: baseline/legacy-fault event and summary files, fixed event/summary files, heartbeat/gateway logs and final test/build logs. They contain metadata, not credentials or speech. The first attempted fixed run stopped before its checkpoint and is not counted as a pass.

To repeat locally, start `verifyOralExam.js` with `NODE_ENV=test`, `ORAL_EXAM_FIXTURE_SLOW_ANSWERS=true` and `ORAL_EXAM_DIAGNOSTICS=true`; start `verifyOralExamProxy.js` with `NODE_ENV=test`; run Vite on port 3110 with `VITE_ORAL_EXAM_API_URL=http://localhost:5500/api`. Use the fixture's synthetic account and a fake browser microphone. At four minutes, POST to `http://localhost:5500/__fixture/drop`. Keep the original tab open through the ten-minute deadline. Only for the comparison run, set `ORAL_EXAM_FIXTURE_LEGACY_CLAIM=true`. That switch exists exclusively in the isolated test script, not the application configuration.

## 9. Deployment and outstanding production check

1. Apply additive **007 to the shared academic/gateway PostgreSQL database before deploying the backend**, using the existing migration command. Keep earlier migrations/data. Readiness checks the ledger and actual column. Never point the fixture at production.
2. Deploy each backend using that database, then the frontend. Keep Oral Exam on Render. No JWT rotation or timeout change is needed. Old clients without the capability retain lease-expiry recovery until refreshed.
3. Rollback can retain the nullable column. Do not remove stored exams or drop tables.
4. Connect the actual EduFusion Render/Vercel workspace and correlate the affected session's socket UUID, close, pong/lease/auth state, provider stage and deployment lifecycle. Diagnose the historical LectureScribe upstream failure separately.
5. Before declaring the production incident resolved, deploy the reviewed patch and run a provider-backed exam beyond six minutes, intentionally interrupt/recover, verify fixed expiry and unique turns, and check a physical microphone. Capture safe diagnostics.

## 10. Pull request

[Draft PR #19](https://github.com/GraduationGroup101/EduFusion-AI/pull/19). Do not merge before migration/deployment review and the outstanding production verification.
