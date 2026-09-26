# Gateway contracts

All protected endpoints require `Authorization: Bearer <EduFusion JWT>`. A provider's `401/403` maps to `502`; it must never invalidate an EduFusion session. Account lookup outages return `503`. Invalid user credentials return `401`; inadequate roles return `403`.

## Prediction and scenarios

- `GET /api/student/prediction?code_module=...&code_presentation=...&force=1` returns the actual prediction for an owned enrollment. Omit `force` to prefer the current-day database result.
- `GET /api/student/prediction-data` returns actual academic evidence. It never includes scenario overrides.
- `PUT /api/student/scenarios/:enrollment_id` validates and replaces a separate scenario. The older `PUT /prediction-data/:enrollment_id` URL is a compatibility alias for this safe operation, not a source-record editor.
- `GET /api/student/scenarios/:enrollment_id` returns `{scenario: {data, updated_at} | null}`.
- Inputs: integer `quiz_clicks`, `forum_clicks`, `resource_clicks`, `activity_days`; optional scores and delays for the latest TMA/CMA and a new TMA/CMA submission. Unknown fields, nulls, fractional counts, and invalid limits return `400`.
- Saved scenarios expose `inputs`, an exact distribution of extra clicks, `projected` values and `based_on_day`. `prediction` is `null` and `prediction_available` is `false` until EduPredict provides a documented feature-based inference contract.
- The integrated upstream contract remains `GET /students/{student_id}/prediction?code_module=...&code_presentation=...`. Do not temporarily write hypothetical values into shared tables to call it.

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
