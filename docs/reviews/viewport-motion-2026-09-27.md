# Viewport, toolkit and orbit verification — 2026-09-27

Historical pass: [the subsequent branding and spotlight refinement](brand-spotlight-2026-09-27.md) removes the logo containers and orbit control, introduces the symbol-only favicon, and changes the toolkit to a single front-card sequence.

Continuation of PR #5, `codex/edufusion-ui-ux-refinement`. This report supersedes the earlier preview-focused motion description. No backend, route, dependency, authorization or provider-contract changes are included.

## Delivered behavior

- Navbar and footer use tightly cropped, genuinely transparent official mark/wordmark PNGs, with transparent CSS backgrounds. New `-alpha.png` URLs avoid stale copies of earlier opaque assets. The full crop is 973×716, symbol 546×454 and wordmark 973×173. Existing artwork pixels and proportions are preserved. The authentication contrast surface is a separate CSS container.
- Desktop authentication uses a `100dvh` shell with adaptive spacing, typography and branding. Login fits the ordinary laptop viewport. Registration keeps the marketing panel stationary while the form owns vertical scrolling. Mobile places the form first and both sections in normal flow. Very short windows retain scroll access.
- Four upright, clickable hero labels orbit 90 degrees apart around an ellipse over 28 seconds. Hover, keyboard focus, manual pause, document visibility and offscreen state control playback. Tablet/mobile uses static chips; reduced motion retains stable positions.
- `#tools` now owns the main Scroll Craft sequence: EduPredict → LectureScribe → Academic Chatbot → Quiz Generator → complete toolkit. A contextual column stays beside the readable cards. Scale, translation and border opacity track 640px of native scrolling. Pinning only activates when the full stage fits; short screens and smaller widths return to normal flow. Reduced motion shows the complete state.
- The concept preview is static supporting content. Removed its old pinning/progress code and unused hero-depth/reveal declarations. Its existing user-initiated video behavior remains.
- Footer branding is compact with a separate readable tagline. Short laptop layouts reduce decorative vertical spacing.

## Automated project checks

| Check | Result |
| --- | --- |
| ESLint | Passed |
| Backend tests | 45 passed |
| Frontend tests | 26 passed across 7 files |
| Vite production build | Passed |
| Typecheck | No standalone typecheck configured; project uses JS/JSX |
| `git diff --check` | Passed |

The baseline landing regression now also checks all toolkit cards and their real navigation targets when browser animation APIs are absent. The test's initial heading matcher was corrected for accessible-name whitespace; the final frontend suite passed.

## Production-browser coverage

Chromium via Playwright CLI against the production preview on port 4173. Protected routes used isolated API fixtures matching existing contracts; no production accounts, data writes or live AI providers were used.

Main matrix: **121 route/viewport combinations** across landing, login, registration, admin dashboard, At-Risk Students, Academic Clock, staff EduPredict, Academic Chatbot, Quiz Generator, LectureScribe and chatbot administration.

Viewport matrix: **1920×1080, 1536×864, 1440×900, 1366×768, 1280×720, 1280×800, 1024×768, 768×1024, 430×932, 390×844, 360×800**. No document horizontal overflow, broken brand images or console/page errors were detected in that matrix.

Additional checks:

- Student dashboard and prediction: **24 combinations**, including all above sizes and 683×384 as a small layout-area check.
- Populated/long workspace screens: **24 combinations** across eight routes at 1366×768, 1280×720 and 390×844. Used 32 at-risk records and multiple clock rows; bottom buttons remained reachable and no overflow failures were detected. Tables retain their own horizontal scrolling.
- Login: both columns and the document exactly match viewport height at all seven desktop sizes. All four marketing items, footer and CTA fit without vertical scrolling. At 1366×768 the CTA bottom is about 525px and the marketing footer bottom about 745px; at 1280×720 these are about 499px and 698px.
- Registration: first-step form intentionally scrolls at 1280×720 and 1024×768; branding does not. Second-step submit is reachable at all eleven sizes. At 1366×768 the form scrolls about 235px to show the bottom action while the brand panel scroll offset stays zero. Mobile form overflow is `visible`, with ordinary page scrolling and all four marketing items retained below it.

## Motion and interaction evidence

- **455 orbit samples**: 65 positions through the complete revolution at each of seven desktop sizes. Four animations present; no label/logo, label/label or container-edge collisions.
- **35 toolkit samples**: start, 25%, 50%, 75% and final at each desktop size. Active sequence is consistently 1, 2, 3, 4, complete. All four links stay inside the viewport. Stage height is about 515px, or 533px at 1024px width, with a 108px sticky top. A step/caption mismatch found at fractional boundaries was corrected and all samples rerun.
- Native wheel scrolling advances the sequence. Sticky release follows document scrolling smoothly: stage top stays 108px through the end, then decreases with the scroll delta. A 1024×600 window disables pinning.
- Hover/focus pause, explicit pause/resume, reduced motion and static mobile fallback passed. Resizing between desktop/mobile/reduced-motion states does not leave stale animations or pinning.
- Menu Escape returns focus; landing controls retain 44px target heights. Toolkit/preview links remain keyboard reachable.
- Concept media remains unloaded until Play; playback, pause, offscreen pause and poster fallback remain functional. JavaScript-disabled introductory content remains readable.

## Transparency and visual inspection

Decoded image pixels confirm transparent corners and substantial fully transparent background areas in all three PNGs: 455,108 pixels in the full logo, 101,979 in the mark and 81,362 in the wordmark. Header brand and image computed backgrounds are `rgba(0, 0, 0, 0)`; at 1366px its visible composition measures about 190×37px within the existing 92px header.

Inspected rendered login/register, desktop/mobile landing, all toolkit progress states and logo placements on white, mint and dark green. No baked-in canvas or unwanted white halo was visible; the pale book-page artwork is retained. Header remains 92px desktop / 74px mobile; workspace header 68px / 64px. Existing muted-copy contrast measurements remain at least 5.23:1 on the tested light surfaces.

Local screenshots and QA scripts are retained in ignored `output/playwright/` for this workspace (including `quality-login-1366.png`, `register-step2-1366x768.png`, `toolkit-0.png` through `toolkit-1.png`, `toolkit-mobile.png`, and `alpha-surfaces.png`). Generated bundles, fixtures and screenshots are excluded from the commit.

## Limits

These are browser-emulated viewport and fixture-based checks, not physical-phone certification or deployed provider tests. Long forms and data screens intentionally scroll; the design does not force all content into one viewport. The repository's concept films retain historical imagery. The PR remains open for human review and is not merged.

A full **28.2-second live orbit run** at 1366×768 also completed: 1,694 sampled frames averaged 16.65ms (maximum 17.5ms), with no observed long tasks; all 29 one-second position samples stayed upright and visible. Recorded layout shift was approximately 0.00036. Offscreen pause passed after the cycle. These measurements describe this local headless Chromium run, not a device-independent frame-rate guarantee.
