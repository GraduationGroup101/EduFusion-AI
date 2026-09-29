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
- Saved scenarios expose `inputs`, an exact distribution of extra clicks, `projected` values, `based_on_day`, an `evidence` snapshot of the records they were built on, and `plan`. `prediction` is `null` and `prediction_available` is `false`: the hypothetical result is never persisted.
- Students never receive a "save as actual" operation. The shared academic tables are treated as source-of-truth records; see [the What-if review](reviews/edupredict-whatif-2026-09-30.md).

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
