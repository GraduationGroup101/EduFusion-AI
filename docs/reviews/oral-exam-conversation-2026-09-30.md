# Oral Exam: conversational turns and feedback retry

Date: 2026-09-30. Scope: `backend/src/oralExam/*`, `backend/src/routes/oralExam.js`, the Oral Exam page and voice hook. Voice capture, scoring weights, the ten-minute timer, authentication, leases and persistence rules are unchanged.

## 1. Previous interaction logic

- ElevenLabs realtime STT commits a transcript after 1.5 s of silence. The socket handler took every committed transcript while in the `listening` phase and called `advance(text)`.
- `advance` stored the text as the answer of the current turn (`recordAnswer`), asked the examiner model for an assessment and the next question in one structured call, committed both, and spoke the new question.
- There was no notion of conversational intent. "Can you repeat the question?" was saved as the answer, scored, and followed by a new question. Because the model is forbidden from repeating a question text (`repeated_question`), a repeat was impossible by construction.
- The evaluation endpoint returned only the session. When the model failed again, the response still carried `evaluation_status: failed`, so the page re-rendered the same "could not be generated yet" text.

## 2. New turn / intention model

Every utterance is classified as `answer`, `repeat`, `clarify`, `dont_know` or `unclear` (`backend/src/oralExam/conversation.js`).

1. **Deterministic first pass** for short utterances (at most 14 words): English and Arabic patterns for repeat, clarify and "don't know", after Unicode normalisation (Arabic diacritics, alef/ta marbuta/ya variants, apostrophes). Empty, letterless or filler-only speech is `unclear`. Longer utterances skip this pass so an answer that contains "don't know" or "repeat" is never intercepted.
2. **Model classification** for everything else, inside the existing structured decision. The decision contract is now `{intent, reply, assessment, next}` (Zod and Groq strict schema). A control intent may not carry an assessment or a next question; a clarification or nudge must carry a short `reply`, and the reply is rejected if it copies eight consecutive words of the evidence (`leaks`). Invalid decisions are retried once as before.
3. **Limits per question** (`resolve`): 2 repeats, 1 clarification, 1 nudge, 2 retries, 4 exchanges in total. Past a limit the student gets the single nudge if unused; after that, whatever they say is treated as the answer so the exam always progresses. The timer is never paused.

The socket `question` event now carries `kind` (`question`, `repeat`, `clarification`, `nudge`, `retry`) and `remark` with the unchanged `sequence`, so the existing playback → `played` → listen loop is reused unchanged.

## 3. Repeat / clarification behaviour

| Student | Examiner | Model call |
| --- | --- | --- |
| "Repeat the question", "say that again" | "Of course. Here is the question again." then the same persisted question | none |
| "I didn't understand", "what do you mean?" | A one- or two-sentence rephrasing from the model (fallback: "Let me put the question another way." plus the question) | one `conversation_reply` call with only the current question's evidence |
| "I don't know" (first time) | A gentle nudge inviting whatever they remember, no hint | one `conversation_reply` call |
| "I don't know" (after the nudge) | Recorded as the answer, assessed, exam moves on | normal decision call |
| "um", silence-like transcript | "I did not catch that clearly. Please say your answer again." | none |
| Partial answer | Assessed; the next question must be a `follow_up` on the same concept targeting the identified `improvements` unless two follow-ups were already asked in a row | normal decision call |

## 4. Arabic behaviour

The same classifier covers Arabic dialect and standard forms: عيد/أعد/كرر السؤال, مرة ثانية, ما سمعت (repeat); مش/مو/ما فاهم, ما فهمت, وضح/اشرح السؤال, يعني ايه, شو قصدك (clarify); ما بعرف, مابعرف, لا أعرف, مش عارف, ما أدري, نسيت, معرفش (don't know). Fixed replies exist in Arabic, and model replies are requested in the session language. The integration test drives an Arabic session through عيد السؤال → مش فاهم → وضح السؤال → ما بعرف.

## 5. Scoring semantics

| Property | Repeat / clarify / nudge / retry | Answer |
| --- | --- | --- |
| Counts as a turn | No | Yes |
| Affects score | No | Yes |
| Stored in transcript | Yes, as `exchanges` on the question, with the student's words and the examiner's reply | Yes |
| Affects completeness | No | Yes |
| Consumes the 30-question budget | No | Yes |
| Enters the final evaluation | No (only turns with an answer are sent) | Yes |

Reasoning: a request to repeat or clarify is not evidence of understanding, so scoring it would penalise hearing or phrasing problems rather than knowledge. Storing it keeps the review coherent and lets the examiner model see what was already clarified. The limits prevent the requests from becoming a way to avoid answering, and the second "I don't know" being the answer of record keeps the assessment honest without a punitive zero on the first hesitation. A transcript recorded provisionally before the model classified it as a request is cleared (`recordExchange` sets `transcript` and `answered_at` to null while `assessment` is null), so it can never be scored later or after a reconnect.

## 6. Retry feedback root cause

The button did send a request and the backend did retry; the problem was that neither side surfaced the outcome:

- `examiner.evaluate` swallowed the failure, marked the row `failed` again and returned nothing. The route returned only the session, whose `evaluation_status` was still `failed`.
- The page rendered the same sentence for "failed before" and "failed again", showed no generating state (only a disabled button for up to fifty seconds), and had no reason to display. A request error (for example the 30-per-15-minutes limiter returning 429) went to the generic page error banner, away from the button.
- The automatic first attempt on a `pending` session and a manual click could both fire, with no client-side guard.

So the categories were: missing loading indicator, response contract without an outcome, and a UI that could not distinguish "still failed" from "nothing happened". The request was sent and persistence worked.

## 7. Fix

- `examiner.evaluate` returns `{status: 'ready' | 'failed' | 'skipped', error?, cached?, unscored?}` and never throws; concurrent callers share one attempt (existing in-memory map), a ready report is never regenerated.
- `store.evaluationFailed(id, code)` records a safe reason (`evaluation_error`) and increments `evaluation_attempts`; `saveEvaluation` clears the error. Both columns are added by migration `007_oral_exam_conversation.sql` and exposed in `publicView`.
- `POST /sessions/:id/evaluation` and `/end` return `{session, evaluation}`.
- The page keeps an explicit feedback state: **Retry feedback → Generating feedback… (disabled, `aria-busy`) → report**, or **→ reason text + button enabled again**. One in-flight request per session is enforced with a ref shared by the automatic first attempt and the button; a late response for a session the student left is ignored. Reason codes map to student-facing sentences that state the answers are saved.

## 8. Files changed

- `backend/migrations/007_oral_exam_conversation.sql` (new)
- `backend/src/oralExam/conversation.js` (new), `contracts.js`, `examiner.js`, `store.js`, `realtime.js`
- `backend/src/routes/oralExam.js`
- `backend/test/oralExamConversation.test.js` (new), `oralExam.test.js`, `oralExamModel.test.js`
- `frontend/src/pages/OralExamPage.jsx`, `frontend/src/hooks/useOralExamVoice.js`, `frontend/src/styles/oral-exam.css`, `frontend/src/test/OralExam.test.jsx`
- `docs/oral-exam.md`, this review

## 9. Tests

Backend (PGlite, real WebSocket, deterministic providers):

- Classification of English and Arabic repeat / clarify / don't-know phrases; answers that contain those words are not intercepted; filler-only speech is unclear.
- Limits: repeats and clarifications are bounded, then one nudge, then the answer of record.
- Leak guard rejects a clarification that copies the evidence; prompt content includes the current question's exchanges and the follow-up rule.
- Examiner validation: control intents may not score or advance; clarify requires a reply; initial decisions must be answers; `reply()` retries an ignored intent and rejects a leaking reply.
- Realtime English flow: repeat → clarification → nudge on the same sequence with no model call, second "I don't know" advances and is assessed, a partial answer yields a follow-up, "um" yields a retry; turn count, transcripts, exchanges, `started_at` and `expires_at` verified; public view carries the exchanges.
- Realtime model-classified flow: a long utterance the model calls `clarify` clears the provisional transcript.
- Realtime Arabic flow: عيد السؤال, مش فاهم, وضح السؤال, ما بعرف with the same bounds and an unchanged deadline.
- Feedback retry through the HTTP route: provider 503 → `failed/model_unavailable`, invalid output → `failed/invalid_model_output` with attempt counts, two concurrent retries share one model call and both receive the ready report, a further retry is `cached`, saved turns are byte-for-byte unchanged.

Frontend (Vitest):

- Retry feedback: generating state with a disabled `aria-busy` button, repeated clicks send one request, a second failure shows its reason and re-enables the button, success renders the report, no start/end calls, review still lists the saved answer.
- Request failure (429) shows the gateway message and stays retryable.
- Pending feedback is requested once automatically; a click during generation is ignored.
- The examiner remark is shown under the unchanged question with its kind as the accessible name.
- The review lists exchanges under their question, separate from the answer.

`npm run check` (ESLint, backend, frontend, build) result is recorded in the pull request.

## Limits and follow-ups

- The deterministic vocabulary is a safety net; unusual phrasings rely on the model's `intent`. Both paths are bounded by the same limits.
- The 1.5 s VAD commit is unchanged: a long mid-answer pause still commits a partial transcript. That is an existing capture behaviour, not changed here.
- The leak guard is lexical (eight-word overlap). It stops quoting, not every possible paraphrase; the prompt forbids hints and the review shows every reply.
- Physical-microphone verification of the spoken replies in both languages remains manual.
