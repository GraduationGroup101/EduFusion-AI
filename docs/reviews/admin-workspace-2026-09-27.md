# Administrator workspace correction

The live administrator page displayed a "Chatbot administration moved" placeholder, and LectureScribe used the administrator's personal job list even though its provider contained 32 jobs.

The admin Academic Chatbot section now renders the existing chat interface and retains its original knowledge-management link. Administrator navigation has one Academic Chatbot entry. The original chatbot repository, deployment, settings, and knowledge data are untouched; the shared chat and question-generator implementations are unchanged.

LectureScribe administrators can list and open all provider transcripts, with saved metadata as a fallback when provider refresh fails. Search, status filtering, and pagination expose older jobs that the previous eight-item truncation hid. Students and advisors retain account-scoped transcript access. Disabled saved-study controls are omitted until that separate feature is available.

When independent learning storage is enabled, an admin catalogue exposes only lecture content. Student conversations, quizzes, attempts, and processing jobs retain their existing membership checks. An explicit admin import creates a personal membership using a trusted provider source; it never copies a student's private study activity.

Validation covers global admin reads, foreign student/advisor rejection, private-history isolation, cached-provider fallback, explicit admin import and replay, existing admin chat rendering, disabled-feature display, and older transcript navigation. Frontend tests and the production build passed locally. Full CI additionally runs backend integration tests, the independent Python engine tests, and dependency checks. No new production migration is required.
