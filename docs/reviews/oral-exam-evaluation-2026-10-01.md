# Oral Exam evaluation and conversation

## Observed failure

Render service `srv-d998b91o3t8c73f1mtr0` production logs on October 1 show `final_evaluation` failing with provider HTTP 400 `json_validate_failed` at 07:00:24 UTC. At 07:06:16–17 UTC, its attempts failed first with 400 `json_validate_failed`, then 429 `rate_limit_exceeded`. This establishes both output-validation rejection and throttling, not only rate limiting. The existing provider diagnostics lack session identifiers, so these entries cannot uniquely identify an individual student's failed report. No provider response text or student content was collected.

The application previously asked the final model for all four numeric dimensions, derived a weighted score from that response and saved nothing when it failed. Persisted per-answer assessments were available but unused as a fallback. Also, a provider JSON-validation rejection was classified as generic model unavailability. That safe error code now distinguishes invalid output.

## Deterministic report

`grading.js` accepts only completed transcripts with valid persisted assessment objects. Dimensions use understanding 35%, accuracy 35%, completeness 20%, communication 10%. Each distinct assessed core concept has equal weight, irrespective of its question count.

- With no assessed follow-up: concept dimensions equal initial-answer dimensions.
- Otherwise: concept dimensions = 0.6 × initial + 0.4 × mean(assessed follow-ups).
- Each concept score is the weighted sum, rounded to one decimal; core score is the mean of concept scores rounded to a whole point. Displayed concept/overall dimensions are rounded to one decimal.
- Bonus = 5 × max(0, (best assessed bonus score − 60) / 40), rounded to one decimal, only after required core coverage. Best bonus performance is used so another weak bonus cannot remove earned credit.
- Final score = min(100, core score + bonus). No completed assessed core means an unscored report, never an invented zero.

Examples: initial 60 + follow-up 90 → concept 72. Core 78 + bonus performance 20 → final 78; bonus performance 92 → +4 / final 82. Core 98 + bonus 100 → +5 / final 100.

The first terminal read can derive a core report without a provider request. End/evaluation/closing persist an immutable `core_evaluation` before asking for commentary. Written feedback has a separate status via the existing `evaluation_status`; `ready` means commentary is ready, `failed` means only commentary failed. The numeric report remains returned in either case. Retry cannot change stored core scores. An in-process promise and a database claim token/150-second lease prevent concurrent or stale feedback workers from overwriting newer outcomes. Provider requests are bounded to two 25-second attempts with at most 60 seconds between attempts.

The version-1 report exposes required/completed concepts, follow-ups and bonuses asked, per-concept scores, assessed/unassessed answer counts, covered topics, termination reason and recorded technical interruptions. Untested concepts and saved but unassessed answers receive no fabricated score. Interruptions never change numeric marks.

## Historical compatibility

`legacy.js` explicitly identifies a historical session when `core_evaluation`, `context.oral_policy` and `context.core_plan` are all absent/null. A saved core evaluation or either policy marker retains the version-1 path, including new exams closed before a plan was generated. Historical question order is never used to infer new grading policy.

A usable saved historical evaluation is returned as `version: 0, legacy: true`, preserving the exact persisted score, four dimensions, strengths, improvements, topics and summary. Validation uses the previous report contract plus its persisted numeric score; validated text is returned unchanged, not trimmed by parsing. The UI displays these saved values and omits modern coverage, bonuses, concept formulas and weighting annotations. Neither reads, `ensureCore`, ending an already-ended session nor evaluation retries rewrite the saved report or fabricate `core_evaluation`.

Without a usable historical evaluation, the API returns a version-0 unscored report with null dimensions/score and `evaluation_status: unavailable`. It explains that no complete evaluation was saved and preserves access to the original question/answer review. It does not calculate a substitute score or request provider regrading. This is a read-time representation only: the stored pending/failed status and original data remain untouched. Background feedback selection excludes these historical rows before its four-row limit, preventing them from starving new reports.

Migration 011 is unchanged and remains additive; there is no historical data or score migration. Production verification must compare at least one existing pre-011 report's score, dimensions and commentary with its pre-rollout values and confirm absence of invented coverage. That live comparison has not yet been performed.

## Written feedback presentation

For version-1 reports, aggregated per-answer strengths and improvements remain visible immediately. Optional AI summary, strengths and suggestions appear separately under Overall feedback, with the lists explicitly labelled AI feedback. Retry detailed feedback retrieves all three commentary fields without replacing deterministic feedback or numeric results. Historical reports continue to display their original summary and original lists once.

## Core plan and conversation

The existing first question request also proposes a cited concept plan, sampling evidence across the material. The default target is five, configurable with `ORAL_EXAM_CORE_CONCEPTS` (1–8), snapshotted in session context. A smaller grounded plan is allowed for limited material and disclosed in the report. New core questions must match distinct plan names. Follow-ups inherit the current core's identifier and parent sequence and remain limited to two. Bonus classification is only allowed after all required cores; no frontend state decides these rules.

An optional `transition` comes from the same scored-answer request. It is limited to one short sentence, localized, and persisted with the next question. It is displayed and spoken before that question. A conservative vocabulary check permits only content-neutral acknowledgements in English/Arabic; evidence-copying, numeric grading, questions and explanatory content are rejected. Unsafe transitions are omitted while a valid assessment/question survives. This can suppress some benign wording; it avoids replacing it with repetitive canned praise.

## Timer and closing

The original database deadline, lease and sequence fencing remain authoritative. Progression is checked again inside the transaction with database time. At 60 seconds or less, no new core or bonus begins; at most an eligible current-concept follow-up is allowed. At 15 seconds or less, no new question begins. Completed answers are retained even when a proposed next question is suppressed.

At hard expiry, answer capture/provider work stops and the session becomes `timed_out` with `ended_at` capped at its original deadline. The explicit closing phase emits localized text and attempts closing audio for at most six seconds, then sends the terminal snapshot. This presentation window does not accept answers or extend the deadline. Failed TTS cannot block the report; closing text is also available after refresh. The browser stops capture at zero, rejects late question/audio frames and has an eight-second delivery fallback. The `ended` phase notification must not suppress the following authoritative terminal snapshot.

Audio rate-limit closes now use 4508; 4429 remains lease contention. Both previously shared a misleading log reason. Rate-limit thresholds and security protections are unchanged.

## Persistence and rollout

Additive migration `011_oral_exam_evaluation.sql` adds core evaluation, feedback-worker ownership, bounded interruption metadata and turn category/concept/parent/transition columns; it permits the additional `bonus` question type. Apply it before starting the new backend. Session context holds the policy snapshot and core plan. No student grades, activity, prediction or hypothetical-scenario tables are changed by this work.

Use the frontend and backend from this branch together for the new report UI. Old frontend clients can still show the returned numeric report but do not expose the new detailed-feedback controls. No change to provider keys, hosting tier, JWT lifetime, CORS or the ten-minute duration is required. The branch is based on main at `3bb6a7e`; it must be reviewed through a PR, without an agent merge to main.

## Verification

Automated tests cover deterministic formulas, no-answer/incomplete/technical cases, failure → fallback → successful commentary retry, stale feedback-worker fencing, persisted five-core/follow-up/bonus coverage, transition order, unsafe-transition omission, final-minute/30-second/15-second progression, hard timeout and closing, and the existing authentication/upload/reconnect/lease protections.

After the compatibility fix, full validation passed: 158 backend tests, 110 frontend tests, ESLint and the production Vite build. The focused grading/legacy/Oral Exam integration run also passed all 37 tests, including feedback failure/retry, refresh stability, core/follow-up/bonus, closing and reconnect. The historical regressions compare complete stored session/answer rows before and after repeated GET, evaluation retry and end requests, not only rendered scores. The browser preserves the server's terminal status if transport drops during normal closing. CI results for the exact commit are available on PR #23.

The 210-second isolated real WebSocket/database soak passed with 40 clocks, two welcomes, three retained answers and unchanged start/deadline. Providers in this soak are deterministic fixtures. In the in-app browser, isolated account 99001 saw 82/100, 5/5 core concepts and all four dimensions after an injected final-provider 503. Clicking Retry detailed feedback restored commentary without changing scores; refreshing preserved the complete report and localized closing text. These checks use real local authentication, HTTP, database and UI, with fixture providers; they do not prove live provider availability. No production academic records were changed.

Production diagnostics were inspected before implementation. This PR has not been merged or deployed to production; post-deployment migration, live-provider and Render log verification remain rollout checks. Deploy backend after migration 011, then the matching frontend, and run a disposable-account exam before declaring production verification complete. Concept-plan semantic quality and whether limited material truly warrants fewer concepts still depend on the examiner model; application code enforces identities, counts, scores and cited-evidence references.

## Changed files

- Backend scoring and progression: `backend/src/oralExam/grading.js`, `progression.js`, `legacy.js`, `contracts.js`, `conversation.js`, `examiner.js`, `store.js`, `realtime.js`, and `backend/src/routes/oralExam.js`.
- Persistence/configuration: `backend/migrations/011_oral_exam_evaluation.sql`, `backend/.env.example`.
- Report and lifecycle UI: `frontend/src/components/oralExam/ExamReport.jsx`, `frontend/src/pages/OralExamPage.jsx`, `frontend/src/hooks/useOralExamVoice.js`, `frontend/src/styles/oral-exam.css`.
- Backend tests/fixtures: `backend/test/oralExamGrading.test.js`, `oralExamLegacy.test.js`, `oralExam.test.js`, `oralExamConversation.test.js`, `oralExamModel.test.js`, `authMigration.test.js`, `lectureStudy.test.js`, `platform.test.js`, and `backend/scripts/verifyOralExam.js`. The three broader suites only update their expected migration count.
- Frontend tests: `frontend/src/test/OralExamReport.test.jsx`, `OralExam.test.jsx`, `OralExamVoice.test.jsx`.
- Documentation: this report, `docs/oral-exam.md`, `docs/api-contracts.md`.
