# Oral Exam evaluation and conversation

## Progression resilience after 5732e9c (October 2)

The saved assessments/commentary in the single prior grounding exam stayed source-derived, but it reached only 2/5 cores. A valid current assessment and an invalid next proposal shared one model validation callback; rejection of the next rubric retried the entire response and discarded the otherwise valid grade. The transaction also coupled assessment persistence with appending the next question. These were application coupling defects; Groq HTTP429 was a separate provider limitation.

Answer decoding now validates the assessment independently while treating the next proposal as untrusted input. A bad next shape, citation, rubric, unsupported follow-up, duplicate or invalid progression sets a safe next-only recovery reason. It does not cause another assessment request. The realtime path commits the validated assessment under its lease first, then appends the valid next question or recovers it separately. Once saved, the grade is immutable; conflicting writes fail. Active sessions whose last turn is already assessed represent pending progression using existing columns, so no migration is required. Migration011/012 and historical reports are untouched.

Recovery makes at most one next-only request targeting saved non-met criteria when a grounded follow-up is possible, then at most one distinct request for the first uncovered core or an eligible bonus. It supplies the saved assessment as authoritative and never asks for scores. Both responses pass the same strict grounding, rubric, duplicate and time/progression checks. Exhaustion closes gracefully with the grade retained. A transient HTTP429 wait is bounded by the original deadline and the provider's retry delay. The hard deadline, final-minute policy and 30-turn bound still apply.

On reconnect during recovery, the newly fenced owner sees the saved assessment and continues next-only generation. It does not replay or regrade the answer. The stale owner cannot append its late result. Database sequence checks prevent duplicate turns; resumed delivery suppresses acknowledgement replay.

Eight new regressions cover malformed/unsupported next proposals, authoritative assessment persistence, successful grounded follow-up recovery, fallback to the next core, bounded graceful close, unchanged expiry, immutable/fenced/idempotent persistence, post-core bonus eligibility, and a real WebSocket reconnect while a recovery response is blocked. The reconnect asserts one assessment request, one saved answer/grade, no duplicate question, no recovery error/reconnect request and suppressed transition delivery.

Final validation and the single targeted production outcome are recorded in PR23's latest verification section. Prior historical, upload, migration and speech evidence below is preserved and is not being repeated.

## Grounding release fix after production verification of 60dc839

The subsequent single disposable live exam completed with 93.2/100 (core 91, bonus +2.2), 5/5 cores, three bonuses and eight assessed answers. Speech/playback recovery, reconnect acknowledgement suppression, final-minute closing with MP3 audio, fencing and refresh stability passed. Weak bonuses added zero and did not remove earned credit. These results supplement the 91/100 and 75/100 historical evidence below; those sessions and their reports are not rewritten.

That run exposed the remaining blocker: assessment feedback expected forward error correction, client-side prediction, state interpolation and redundant packet sending absent from the supplied notes. Citation validation covered generated questions only. The assessment contract admitted unrestricted scores/prose; retrieval mixed the current question's chunks with upcoming/unused chunks. Commentary then admitted fresh academic prose from the saved assessments. A valid question citation never established a grounded grading requirement.

New sessions now carry `grounding_version: 1`. Application-owned source criteria are complete sentence/line units (or an unpunctuated bounded excerpt) from the supplied chunks. The model chooses criterion IDs, never invents criterion text. Each new question persists its selected immutable source units in private `grading_criteria` with citations. Migration **012_oral_exam_grounding.sql** only adds that nullable private column and its array constraint; migration 011 is unchanged. Historical sessions receive no rubric, marker or reassessment.

Each decision explicitly separates `assessment_evidence` (the current question's persisted citations) from `question_generation_evidence` (broader retrieval). Assessment must cover exactly the current saved criterion IDs, cite only their allowed current chunks, and provide exact student-answer substrings for non-missing verdicts. Unknown IDs, scope violations, invented quotes, numeric-score/prose injection and altered persisted assessments fail server validation. Question academic vocabulary is constrained to its selected source units plus generic question scaffolding; concept labels may use the broader cited chunk vocabulary, without adding grading criteria; this rejects absent techniques even with a valid chunk citation. A follow-up can select only source criteria marked partial/missing/incorrect in its parent decision. Bonus questions use the same source and rubric validation. Academic terms remain in their source language when the chosen exam language differs; the conservative vocabulary check can reject an otherwise reasonable paraphrase rather than add unsupported knowledge.

Per-criterion levels are closed: met 100, partial 60, missing/incorrect 0. The server averages these for understanding, accuracy and completeness; communication is clarity-only (clear 100, unclear 70). No unrestricted model dimension score is accepted for new sessions. The previously verified report arithmetic remains **35/35/20/10**, initial **60%** plus mean follow-up **40%**, equal core-concept weighting, nonnegative best bonus up to **+5**, and final **<=100**. Scores are reproducible from the saved source basis and criterion verdicts. A model still interprets answer meaning; the hard guarantee is that an outside grading criterion/prose cannot enter the stored assessment.

The server renders strengths/improvements exclusively from those saved source units, with localized fixed feedback. Final commentary chooses validated strength/improvement indices and a generic summary category; the server renders all text. It cannot add an academic claim, untested concept or new curriculum item. Numeric evaluation remains independent of commentary retries. `publicView()` omits the rubric, assessment grounding metadata and context; active TTS receives only the public question/neutral transition. Source-linked feedback becomes visible only in the completed report.

Grounding failures use the existing two-attempt bounded provider policy. On exhaustion the existing recoverable flow retains the transcript without an assessment, so no unsupported mark is invented. The fenced transaction revalidates the immutable rubric and server-derived assessment before writing. The grading reducer revalidates new grounded rows before including them in arithmetic. Old persisted contracts remain supported without rewriting reports.

Adversarial coverage rejects all four absent techniques despite valid citation IDs, a completeness penalty with unsupported prose, future-chunk expectations, fake answer quotes/rubrics, unsupported follow-ups/bonuses, free-form final commentary and forged scores. It accepts source-derived applications and a grounded sequence-number improvement; tests also cover valid retry, Arabic feedback, private persistence/public redaction, failed commentary retry without score change, and the existing 60/40 follow-up calculation. Existing lifecycle tests explicitly represent pre-012 persisted sessions; a separate new-session suite and updated real WebSocket/database soak exercise the new contract.

Local validation: 181 backend tests, 114 frontend tests, lint/build and the 210-second reconnect soak passed. The soak retained three answers with 40 clocks, two welcomes and the same deadline. The single targeted session initially exposed conservative concept-label validation and ambiguous initialization instructions; the label regression and explicit initialization correction preserve the same rubric boundary and two-attempt policy. Targeted production verification follows CI/previews and applies only additive migration 012. Its final findings and exact revision are recorded in PR #23's deployment-verification section after the single disposable source-grounding exam.

## Production follow-up: speech resilience

The first production verification of `5ecc19c` applied migration 011 and deployed matching Render/Vercel revisions without merging PR #23. A pre-migration report retained its saved 91/100 and dimensions 90/95/85/90, original commentary and topics across refreshes; no modern coverage was fabricated. PDF and DOCX extraction passed.

The disposable live-provider exam retained seven assessed answers after transport recovery. It ended with a persisted deterministic score of 75, four of five concepts, three follow-ups and zero bonus. Independent arithmetic reproduced dimensions 74.3/79/68.5/81 and concept scores 51.6/91.3/85.8/73.2. Commentary succeeded separately. Closing text and MP3 delivery completed before the terminal snapshot. The original deadline never changed.

Two issues required follow-up: reconnect replayed the stored acknowledgement; repeated ElevenLabs TTS failures on the fifth question closed the connection and prevented answering despite usable text. Original diagnostics recorded only `stage: tts, error_class: Error`, so the HTTP status and quota/throttle/response cause cannot be recovered from those logs.

Resume now speaks only the current question, retaining its original transition in persistence. A failed synthesis or client playback sends `audio_unavailable` and starts STT on the same fenced connection, with localized text-plus-microphone guidance. Each future question tries TTS again. STT or answer-provider failures still use bounded recovery. Closing remains bounded and does not accept new answers. Safe speech diagnostics distinguish known provider codes, HTTP status, invalid media and timeout classes without logging provider bodies or answer content. Browser API diagnostics serialize only their existing sanitized fields so captured warnings can identify the affected service.

Regression coverage includes acknowledgement replay, same-socket STT fallback, later audio recovery, browser decoding failure, poor/strong bonus after fallback, failed closing synthesis and persisted scores. Transition variety uses recent acknowledgements in the existing model request; the vocabulary and leakage filter remain unchanged. No additional migration is required. The sections below describe the original implementation and pre-rollout evidence; final production follow-up results are recorded separately.

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


## Authoritative assessed-answer counts (October 2, 2026)

The report counter used the legacy strict assessment schema while scoring accepted persisted grounded assessments through storedAssessment. This counted a valid grounded answer as both assessed and unassessed. The reducer now collects answered turns once, builds the validated set using the existing grounded/legacy validation path, and derives unassessed_answers as answered.length - valid.length. Score mathematics, strict grounding, persisted historical reports, realtime progression and migrations are unchanged.

Three new grading regressions prove grounded score/count correctness, missing/forged grounded assessment counts, unanswered exclusion, unchanged legacy behavior and exhaustive answered totals. Both grounded count cases failed before the fix; all 11 grading tests pass after it. Full local validation: 221 backend tests, 156 frontend tests, 15 Python tests, lint and build passed. CI, Vercel checks and the single new targeted production exam are recorded in the latest PR verification section after deployment. No Oral 011/012 migration rerun is required.
