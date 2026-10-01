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

The page lives at `/dashboard/lecturescribe`; old `/dashboard/youtube` links redirect there with their `?job=&tool=` query.

- `POST /api/lecture-scribe/jobs`: `{youtube_url: HTTPS YouTube URL of one video, clean?: boolean, language?: 'auto' | 'ar' | 'en'}`. `language` defaults to `'auto'` and is always sent to the provider; `clean:false` is the fast mode. The URL is reduced to `https://www.youtube.com/watch?v=<id>`; a URL without a video ID is `400`. Provider options are constructed by the server; caller-supplied job IDs and identity fields are never forwarded. The request is answered in this order:
  1. A stored lecture usable for the request (see the transcript library) is saved for this account and returned completed: `200` with `cached:true`, without a new transcription.
  2. An identical request (same video, language and mode) still being transcribed for any account in the last six hours, confirmed alive by the provider, is shared: `202` with `shared:true`. If it finished meanwhile it is saved like a stored lecture, except that a formatted request is not given a job the provider could not AI-format; that one is transcribed anew.
  3. Otherwise a new provider job is created (60-second budget, not tied to the browser connection): `202`. Provider refusals are relayed as `{error}`; provider outages are `503`.

  Re-submitting a lecture this account already saved returns that save unchanged.
- Every job in a response is a client view: `job_id, status, stage, stage_label, progress_percent, current_step, total_steps, stage_started_at, estimated_stage_seconds, submitted_at, started_at, finished_at, error, jobs_ahead, cached, shared, lost, title, video_id, youtube_url, language, mode, produced_mode, detected_language, request:{youtube_url, clean, language}, result:{has_cleaned, has_raw, cleaned_transcript_path ('stored' or null), detected_language, format_version, produced_mode}`. `jobs_ahead` is the number of lectures ahead of a queued job in the provider's queue (it transcribes one at a time), otherwise `null`. `mode` is the requested mode; `produced_mode` is the one actually delivered when known (`'fast'` when no model could format a formatted request). Provider file paths and internals are never returned.
- `GET /jobs`: a student gets up to 500 of their own saves (saves are never evicted); unfinished ones, and ones finished in the last two days whose transcripts are not all stored yet (a download failed), are reconciled with the provider first, within a short time budget. An administrator gets every saved lecture once, from the database only, with `saved_by: [{owner_key, type, id, name, email, role, saved_at}]` and `saved_count`.
- `GET /admin/saves?q=&limit=&offset=` (administrators only, otherwise `403`) lists every individual save, newest first: `{saves: [{owner, job_id, title, youtube_url, language, detected_language, mode, status, lost, saved_at, has_transcript}], total, limit, offset}`. `q` matches a student's name or ID, a username, or the lecture title, URL or video ID.
- `/jobs/:id` and `/jobs/:id/transcript?kind=raw|cleaned` require local creation entitlement **before** calling the provider (administrators may open any job). Unknown and foreign IDs both return `404`; malformed IDs return `400`. A completed job with every transcript kind the provider reported stored is answered from the database; a kind whose download failed is fetched again first (a stored lecture never reports the provider unavailable). If the provider is unreachable, `GET /jobs/:id` still answers `200` with the saved job and `provider_unavailable:true`. A job the provider no longer knows becomes `completed` when a transcript is stored (reporting only the stored kinds), otherwise `failed` with `lost:true` and the error "The transcription service restarted before this lecture finished. Submit it again." (or, for a job that had finished, "The lecture finished, but the transcription service restarted before its transcript was saved. Submit it again."). The transcript endpoint answers `text/plain` with `Content-Language` when the language is known, or `404 {error}`.
- `POST /api/lecture-scribe/callback` (no JWT): the provider reports `{event:'job.finished', job_id, status}` with `X-LectureScribe-Timestamp` and `X-LectureScribe-Signature: sha256=<HMAC-SHA256(gateway key, "<timestamp>.<job_id>.<status>")>`. Bad signatures and timestamps more than ten minutes off are `401`. A known job is reconciled, and its transcripts stored, before `{ok:true}`; when the provider cannot be read or a finished job's transcripts could not all be stored, the answer is `503`, so the provider retries. An unknown job gets `{ok:true, known:false}`. New jobs carry a `callback_url` only when `LECTURESCRIBE_GATEWAY_KEY` is set: `LECTURESCRIBE_CALLBACK_URL`, or else the request's public HTTPS host.
- Jobs continue running after the submitting user leaves the page. The open lecture is kept in the page URL (`?job=`) and the browser session, so it reopens on return. The browser polls without overlapping requests, backs off while the provider is unreachable, pauses while hidden, and cancels its current status request when leaving.
- The provider is `LECTURESCRIBE_API_URL` (default `https://lecturescribe-ai.onrender.com`). The retired `lecturescribe.app` value is ignored if it lingers in a hosting environment.
- The provider limits public callers to 3 new jobs per IP per hour (plus server-wide and queue limits); a 429 with its `Retry-After` is passed through. Because every student submits through this gateway's single address, set `LECTURESCRIBE_GATEWAY_KEY` to one of the provider's `GATEWAY_KEYS`. Every provider call, reads included, then sends `X-Gateway-Key`, and job creation adds `X-Gateway-User` (an opaque SHA-256 digest of the account key, never a student ID). The provider then limits each account individually (`JOB_RATE_PER_USER`, default 6 an hour) and keeps students' jobs out of its public listing.
- **Transcript library.** Both transcript kinds of a finished job are stored in `edufusion_lecture_transcripts` as soon as EduFusion observes the completion: a poll, a list refresh, the callback, or `npm run lectures:sync --prefix backend`. Each row records the requested language and mode, the detected language and the provider's format version (`012_lecture_library.sql`); the mode is the one the provider actually produced, so a formatted request it could only lay out deterministically is stored as fast. A stored lecture is reused only when:
  - it has a format version (older rows may be English translations of Arabic lectures, so they are never reused);
  - for a formatted request, it is an AI-formatted copy (a fast request accepts either);
  - the language matches: an `'auto'` request accepts only rows requested as `'auto'` (a forced language is detected as itself even when the lecture was spoken in another one, since forced Whisper translates), and an explicit language needs text detected in that language, requested as that language or `'auto'`.

  Without migration 012, transcription works as before, without reuse.

## Lecture tools

Grounded chat and practice questions over a saved transcript. Available on any backend with `GROQ_API_KEY`; the frontend routes these calls to `VITE_LECTURE_TOOLS_API_URL`, then `VITE_ORAL_EXAM_API_URL`, then `VITE_API_URL`.

- `GET /api/lecture-scribe/tools/status` returns `{enabled}`. Every other tool route returns `503` when disabled and `404` for jobs the account does not own.
- `POST /api/lecture-scribe/jobs/:id/chat`: `{question: 1–2000 chars}` → `{answer, sources: [verbatim quotes], covered}`. History is kept in `edufusion_chat_history` under session `lecture:<job_id>`. It lasts as long as the saved lecture and does not count towards the chatbot's 20-session cap. `GET` returns `{messages}` and `DELETE` clears it.
- `POST /api/lecture-scribe/jobs/:id/quizzes`: `{num_mcq?, num_tf?, num_essay?: 0–10 each (at least one > 0), language?: 'auto'|'ar'|'en'}` → `201 {quiz: {id, language, questions, created_at}}`. Questions carry `type`, `prompt`, `choices`, `answer_index` (`null` for essays), `answer` and `explanation`; answers are checked in the browser for self-study. `GET` lists this account's last 20 sets for the job.
- A transcript shorter than 100 characters or not yet completed returns `409`. Model output is validated against a strict schema; malformed items are dropped and an empty result is `502`.

## Service warm-up

- `GET /api/services/warm-up` (authenticated) returns `{targets:[{name,url}], started:[names]}` for the transcription, chatbot, question-generator and prediction health endpoints, and pings each from the server at most once per minute without waiting for the response. The browser also pings every `https` target with `no-cors` after any session is established, so sleeping free-tier services wake as soon as a student signs in.

## Oral Exam material

- `GET /api/oral-exam/materials` lists ready study lectures and this account's completed transcripts. Unfinished saved jobs are reconciled with the provider first, so lectures that finished unobserved appear. A transcript source is read from the transcript library first (formatted, then original), then from the provider, whose copy is stored.
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
