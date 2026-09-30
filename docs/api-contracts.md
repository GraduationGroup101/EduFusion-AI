# Gateway contracts

All protected endpoints require `Authorization: Bearer <EduFusion JWT>`. A provider's `401/403` maps to `502`; it must never invalidate an EduFusion session. Account lookup outages return `503`. Invalid user credentials return `401`; inadequate roles return `403`.

## Prediction and scenarios

- `GET /api/student/prediction?code_module=...&code_presentation=...&force=1` returns the actual prediction for an owned enrollment. Omit `force` to prefer the current-day database result.
- `GET /api/student/prediction-data` returns actual academic evidence. It never includes scenario overrides.
- `PUT /api/student/scenarios/:enrollment_id` validates and replaces a separate scenario. The older `PUT /prediction-data/:enrollment_id` URL is a compatibility alias for this safe operation, not a source-record editor.
- `GET /api/student/scenarios/:enrollment_id` returns `{scenario: {data, updated_at} | null, status}`. `status` is `null` without a scenario; otherwise `{state, reasons, based_on_day, current_day, saved_at}` where `state` is `current`, `needs_reevaluation` (same day, but the real records changed since the save; `changed` lists the fields), `stale` (the course day moved) or `invalid` (a referenced assessment or delay window no longer applies).
- `GET /api/student/scenarios/:enrollment_id/prediction` evaluates a saved scenario through EduPredict's `POST /students/{id_student}/scenario-prediction`. `stale` and `invalid` scenarios return `409` with `{error, status}` and never reach the model; `current` and `needs_reevaluation` scenarios return the hypothetical result with `hypothetical: true`, `based_on_day` and `status`. An upstream `422` becomes `409` with an `invalid` status.
- `DELETE /api/student/scenarios/:enrollment_id` removes only the isolated scenario row for the authenticated student. It returns `{deleted: true}`; `404` when the enrollment is not owned or no scenario exists. Academic evidence and the prediction history are never touched.
- `PATCH /api/student/scenarios/:enrollment_id/plan` with `{adopted: boolean}` labels the saved scenario as the student's learning plan (`data.plan = {adopted_at} | null`). This is the non-destructive alternative to "save as actual": nothing is written to grades, activity, submissions or predictions. `404` without a saved scenario or for a foreign enrollment; `400` for a non-boolean.
- Inputs: integer `quiz_clicks`, `forum_clicks`, `resource_clicks` (extra interactions added on top of real activity and spread over the most recent `activity_days` course days); optional `latest_tma_score`/`latest_cma_score` (replaces the score of the most recent submitted assessment of that type) and `tma_delay_days`/`cma_delay_days` (moves its submission to due date + delay, no later than the current day); optional `new_submission_type`, `new_submission_score` and `new_submission_delay_days` for the next unsubmitted assessment whose due date has passed. Unknown fields, nulls, fractional counts, and invalid limits return `400`.
- Saved scenarios expose `inputs`, an exact distribution of extra clicks, `projected` values, `based_on_day`, an `evidence` snapshot, `plan`, `revision` and `created_at`. Evaluation stores the provider result as `prediction`, sets `prediction_available`, and records `predicted_at` and an evidence fingerprint. Saving, evaluating and deleting a hypothetical scenario never writes academic records or actual predictions.
- `POST /api/student/scenarios/:enrollment_id/actual` requires `{confirm: true, revision}` after the user confirms **Save as Actual**. A serializable transaction revalidates ownership, scenario revision, course day and all model evidence; updates activity/submissions and the corresponding prediction; saves a before-image in `edufusion_scenario_applications`; and marks the scenario `applied_at`. Missing evaluation or changed evidence returns `409`. Repeating the same application is idempotent; deleting the scenario preserves actual records and the audit. Applied scenarios have status `applied` and retain their original result. Existing scenarios without a revision must be saved and evaluated again.

## Chat

- `POST /api/chatbot/chat`: `{question: string (1–2000 chars), session_id?: string (1–100 chars)}`.
- Provider: `POST /api/chat/guest` with `question`, opaque `conversation_id`, and the last five complete `{user,assistant}` turns.
- `GET /api/chatbot/history/:session_id` returns persisted `{session_id,messages}`; `DELETE` removes that owner's session only.
- Persistence: PostgreSQL, 24-hour expiry, up to 20 stored sessions per account and 100 messages per session. Account types are separate namespaces. Expired content is not returned; inactive owners' expired rows are removed by the maintenance command.
- The upstream request has one 80-second total budget; the browser has 90 seconds. No automatic POST retry. Health uses a 20-second total budget, including at most one retry.

## LectureScribe

- `POST /api/lecture-scribe/jobs`: `{youtube_url: HTTPS YouTube URL, clean?: boolean, language?: 'auto' | 'ar' | 'en'}`. Provider options are constructed by the server; caller-supplied job IDs and identity fields are never forwarded.
- A successful provider create response must contain a nonempty `job_id`. Creation-derived access is persisted for the authenticated account. If the provider reuses a cached ID for another authenticated create request, that requester also receives creation entitlement; no other owner is overwritten.
- `GET /jobs` lists the last 100 jobs created by this account from local metadata. Status metadata is refreshed when an owned job is opened or polled.
- `/jobs/:id` and `/jobs/:id/transcript?kind=raw|cleaned` require local creation entitlement **before** calling the provider. Unknown and foreign IDs both return `404`. Historical globally visible jobs are not automatically assigned to an owner.
- Jobs can continue running after the submitting user leaves the page. The browser polls without overlapping requests, pauses while hidden, and cancels its current status request when leaving.
- The provider is `LECTURESCRIBE_API_URL` (default `https://lecturescribe-ai.onrender.com`). The retired `lecturescribe.app` value is ignored if it lingers in a hosting environment.
- The provider limits public callers to 3 new jobs per IP per hour (plus server-wide and queue limits); a 429 with its `Retry-After` is passed through. Because every student submits through this gateway's single address, set `LECTURESCRIBE_GATEWAY_KEY` to one of the provider's `GATEWAY_KEYS`; job creation then sends `X-Gateway-Key` plus `X-Gateway-User` (an opaque SHA-256 digest of the account key, never a student ID), and the provider limits each account individually (`JOB_RATE_PER_USER`, default 6 an hour) instead of the shared address.
- **Transcript cache.** A completed transcript is stored in `edufusion_lecture_transcripts` the first time it is read, keyed by the canonical YouTube video ID. `POST /jobs` for a video that already has a stored transcript returns `200` with the finished job and `cached:true`, grants this account entitlement to that job, and never contacts the provider. `GET /jobs/:id` and `/transcript` serve the stored copy when present, so cached lectures survive provider restarts. Administrators see every stored job.

## Lecture tools

Grounded chat and practice questions over a saved transcript. Available on any backend with `GROQ_API_KEY`; the frontend routes these calls to `VITE_LECTURE_TOOLS_API_URL`, then `VITE_ORAL_EXAM_API_URL`, then `VITE_API_URL`.

- `GET /api/lecture-scribe/tools/status` returns `{enabled}`. Every other tool route returns `503` when disabled and `404` for jobs the account does not own.
- `POST /api/lecture-scribe/jobs/:id/chat`: `{question: 1–2000 chars}` → `{answer, sources: [verbatim quotes], covered}`. History is kept in `edufusion_chat_history` under session `lecture:<job_id>` with the same 24-hour expiry; `GET` returns `{messages}` and `DELETE` clears it.
- `POST /api/lecture-scribe/jobs/:id/quizzes`: `{num_mcq?, num_tf?, num_essay?: 0–10 each (at least one > 0), language?: 'auto'|'ar'|'en'}` → `201 {quiz: {id, language, questions, created_at}}`. Questions carry `type`, `prompt`, `choices`, `answer_index` (`null` for essays), `answer` and `explanation`; answers are checked in the browser for self-study. `GET` lists this account's last 20 sets for the job.
- A transcript shorter than 100 characters or not yet completed returns `409`. Model output is validated against a strict schema; malformed items are dropped and an empty result is `502`.

## Service warm-up

- `GET /api/services/warm-up` (authenticated) returns `{targets:[{name,url}], started:[names]}` for the transcription, chatbot, question-generator and prediction health endpoints, and pings each from the server at most once per minute without waiting for the response. The browser also pings every `https` target with `no-cors` after any session is established, so sleeping free-tier services wake as soon as a student signs in.

## Oral Exam material

- `GET /api/oral-exam/materials` lists ready study lectures and this account's completed transcripts. A transcript source is read from the transcript cache first, then the provider.
- Session views include `source: {kind, id}` for lecture and transcript material (never pasted text) so results can link back to that lecture's chat and practice questions. `/dashboard/oral-exam?transcript=<job_id>` preselects a transcript.

## Question generation

- `POST /api/question-generator/generate`: multipart `file`, `num_mcq`, `num_tf`, `num_essay`. Each count is 0–50, at least one must be positive.
- Accepted file extensions: PDF, DOC/DOCX, TXT, PPT/PPTX. The entire multipart body is limited to 4 MiB, including requests without Content-Length. The provider remains responsible for validating/parsing actual file contents.
- Gateway request budget: 170 seconds; browser: 180 seconds. Provider responses are bounded to 10 MiB. Hosting must support this duration; use a job API if it cannot.

## Academic clocks

- `POST /api/admin/clock/tick[-all]` and `/reset[-all]` require `admin/advisor` and an `Idempotency-Key` of 1–100 characters.
- Tick accepts positive integer `days`; reset accepts nonnegative integer `day`. Single-course routes require both course codes. Commands are committed atomically with their idempotency record. Repeating the same key and payload returns the original result with `replayed:true`; reusing a key for a different payload returns `409`.
- Prediction regeneration follows the committed clock operation. Its failure produces a warning and a successful clock response; repeating the clock to recover prediction generation would incorrectly move academic time.

## Evaluation outside this repository

The model and RAG source repositories must separately version evaluation datasets and model releases. Track prediction calibration/recall with appropriate student/course/time splits, chatbot grounding and source correctness, Arabic/English transcription accuracy, and question correctness against source material. This gateway's automated tests validate API compatibility and isolation; they do not measure AI quality.
