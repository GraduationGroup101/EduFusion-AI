# EduFusion frontend refinement

## Scope

The refinement preserves the existing landing composition, approved logo artwork, editorial headline, video assets, routes and application features. Shared surfaces, typography, spacing and module accents now connect the public experience to the workspace.

No backend, provider client, authentication context, route authorization, schema, model, environment configuration or dependency changes are included.

## Changes

- Shared `PageHeader`, `EmptyState` and `StatusBadge` components; reusable semantic colors, radii, content gutters, table regions and form styling. Brand coral is separate from danger red.
- Grouped sidebar navigation, readable inactive states, compact account controls, desktop collapse and a mobile drawer with focus containment, Escape, focus return and an inert background.
- Application logo without the tiny tagline, full footer logo with tagline and symbol-only compact navigation. Original artwork is retained.
- Responsive landing grids and typography, a mobile ecosystem graphic laid out in a grid, aligned tool-card links and proportional video containment. The existing concept film is retained, rather than presenting test data as a product screenshot.
- One case-normalized High/Medium/Low risk legend, matching risk badges, stronger at-risk KPI emphasis, readable tables and responsive charts without resize animation.
- At-risk results use 15-row client pagination and real student-ID/course filters over the current API response. The existing risk-level request and 100-record limit are unchanged and disclosed in the UI. Late responses cannot replace a newer risk selection.
- Academic Clock shows the current day (or that days vary), groups day changes, explains automatic recomputation and retains a separate prediction-refresh action. Duplicate controls for the same refresh action are consolidated.
- EduPredict has visible search labels, an actionable initial state and persistent search-error guidance. Student scenario fields use fewer columns on smaller screens.
- Quiz Generator has compact, labeled counters, a distinct enabled teal CTA and disabled state, an explicit service-health label and visible upload size guidance.
- Academic Chatbot has editable prompt suggestions, labeled composition controls, conversation loading feedback and an explicit offline retry explanation. Scrolling stays within the message area.
- LectureScribe distinguishes the independent saved library from transcription availability, centers its offline state, uses consistent module/status styling and keeps lecture dialogs scrollable on short screens.
- Login and both registration steps preserve their existing flows and use the shared readable, responsive form styling.

## Content

Module names are consistently EduPredict, LectureScribe, Academic Chatbot and Quiz Generator. The old quiz product name is absent from tracked text files. The landing team contains exactly:

1. Abdullah Mohammed Shehdada
2. Basem Hamdi Daqarem
3. Nizar Yousef Alqerem

## Validation

- `npm run check`: passed (ESLint, 45 backend tests, 22 frontend tests and Vite production build).
- Frontend lint, all 22 frontend tests and production build rerun after final markup cleanup: passed.
- No standalone typecheck is configured; this is the existing JavaScript/JSX stack.
- Added regression coverage for at-risk pagination/filtering, the unchanged clock API actions, case-normalized risk badges and the three-entry legend.
- `git diff --check`: passed. No backend/service/auth changes, new dependencies, generated bundles, local environment files or browser fixtures are part of the change.

### Browser QA

The local Vite app was exercised with Playwright in Chromium. Public pages and both account roles were inspected. Protected pages used isolated request fixtures based on the existing response contracts, not production records. Fixtures and screenshots are local QA artifacts and are not part of the application.

Widths checked: 1920, 1440, 1366, 1280, 1024, 768, 430, 390 and 360 pixels. Heights include 1366×768 and 1440×900. Workspace and student pages were additionally checked at 683×384 (the layout area equivalent to a 1366×768 screen at 200% zoom; not a claim of native browser zoom testing).

| Area | Coverage |
| --- | --- |
| Landing, login, registration step 1 | Nine viewport sizes per route |
| Registration step 2 | Nine viewport sizes |
| Admin dashboard, at-risk, clock, EduPredict, chatbot, quiz, LectureScribe, chatbot administration | Ten viewport sizes per route |
| Student dashboard and student EduPredict | Ten viewport sizes per route |
| Mobile navigation | All links, current page, close button, keyboard containment, Escape and focus return |
| Desktop collapse | Collapse/expand and return to expanded mobile navigation |
| EduPredict | Empty search and populated prediction |
| Quiz Generator | Upload, enabled CTA, counter change, generated result and reset |
| Chatbot | Suggested prompt, offline explanation, retry and response |
| LectureScribe | Offline state, saved library and summary dialog while transcription is offline, online submission form |

No document-level horizontal overflow or out-of-viewport headings, controls or cards were found in the final layout checks. Tables remain deliberately scrollable within their own focusable regions. Desktop/mobile screenshots were visually inspected for the principal screens. Intermediate browser issues (drawer focus escaping and whole-page chat scrolling) were corrected and their interactions rechecked.

## Review limits

The checkout has no configured live database or authenticated provider environment. Local regression tests and fixture-based browser interactions do not certify current external AI-provider availability or a deployed end-to-end workflow. No production records were changed or requests submitted to external providers during QA.

Client pagination covers only the existing API's loaded results (up to 100), not every record in the database. Server pagination, new filter contracts and provider recovery behavior remain outside this frontend scope. The original marketing film may continue to show its original interface artwork; its binary assets were intentionally preserved.
