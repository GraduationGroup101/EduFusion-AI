# Transparent branding, favicon and toolkit spotlight — 2026-09-27

Continuation of the same branch and PR #5. This pass implements the latest request and the attached spacing/navbar brief. It supersedes the earlier visible orbit control, authentication contrast box and simultaneous four-card spotlight treatment.

## Final changes

- Removed the authentication logo's CSS background, padding and rounded container, and removed the chatbot logo tile. The shared brand component no longer supports the boxed `light` variant. All brand images and wrappers explicitly have transparent backgrounds, no border and no shadow. Existing tightly cropped official RGBA artwork is unchanged.
- Replaced the old favicon with one `edufusion-symbol-v2.ico`, containing 16×16, 32×32 and 48×48 transparent, symbol-only PNG frames. The symbol retains its proportions and gradients and is centered with only the necessary square-aspect allowance. `frontend/scripts/build-favicon.cjs` reproducibly builds the frames from the official symbol using premultiplied-alpha Lanczos resampling (requires ffmpeg). No full wordmark or tagline is resized into the favicon. Removed `favicon.png`; the Vite HTML has one icon reference and the exact title `EduFusion`. No manifest/PWA/larger app-icon conventions exist in this project.
- Removed the visible Pause orbit button and its state/control code. Hover/focus, offscreen and reduced-motion pauses remain. Mobile orbit chips remain static.
- The toolkit now uses a physical layered deck. Only the current card faces forward at each spotlight: EduPredict, LectureScribe, Academic Chatbot, Quiz Generator. Native scrolling continuously moves, scales and turns those same four cards; the final portion spreads them into the complete grid. It does not replace slides or intercept scrolling. The front face remains readable during handoffs. The progression is 840px, with geometry read on resize and transform/opacity writes scheduled on native scroll.
- Keyboard focus immediately presents the complete stationary grid so all links are reachable. Reduced motion, mobile/tablet and short desktop windows retain normal readable layouts. Pinning is conditional on the entire stage fitting below the header.
- Reduced navbar inner height from 92px to 80px desktop and 74px to 68px mobile. Logo composition is approximately 160–172px wide desktop and 154px mobile; sign-in/menu controls remain 44px tall. Sticky offsets derive from the actual header height.
- Tightened the audience/CTA transition to a measured 48px gap (44px narrow mobile), added aligned audience-column rules, reduced internal headline/card gaps and scaled CTA padding. Both sections own complementary spacing, avoiding two full section paddings accumulating into an oversized gap. The following team section also uses a closer transition.

## Validation

| Check | Result |
| --- | --- |
| `npm run check` | Passed |
| ESLint | Passed |
| Backend tests | 45 passed |
| Frontend tests | 26 passed / 7 files |
| Production build | Passed |
| Standalone typecheck | Not configured in this JavaScript/JSX project |
| Diff whitespace check | Passed |

Production preview was tested in Chromium through Playwright CLI. API fixtures were isolated; no live providers or production records were used.

- **121 route/viewport checks:** landing, login, register, dashboard, At-Risk Students, Academic Clock, EduPredict, Academic Chatbot, Quiz Generator, LectureScribe and chatbot administration. All visible official images and immediate wrappers have computed `rgba(0, 0, 0, 0)` backgrounds. No horizontal overflow, image failures or console/page errors.
- **27 navigation/brand checks:** collapsed sidebar, mobile drawer, landing and chatbot placements. All passed; collapsed rail remains 76px and mobile drawer 288px.
- Sizes: **1920×1080, 1536×864, 1440×900, 1366×768, 1280×720, 1280×800, 1024×768, 768×1024, 430×932, 390×844, 360×800**.
- **119 toolkit samples:** 17 points through the sequence at each of seven desktop sizes, including intermediate handoffs. No card clipping/viewport overflow; the active front face remains fully readable. At 0/25/50/75% each state has exactly one complete front face and the expected tool; at 100% all four are complete.
- Native wheel progression, sticky release, keyboard grid fallback, hover/focus orbit pause, absence of the pause button, reduced motion and resizing to mobile/short-screen fallback passed. Mobile Escape returns focus to the menu trigger.
- Nine-size navbar/spacing checks confirm 80/68px inner header heights, 44px sign-in/menu targets, and consistent 48/44px audience-to-CTA gaps.
- Favicon binary inspection confirms three valid frames with transparent corners: 85/342/878 fully transparent pixels at 16/32/48px. The artwork spans the width and is vertically centered. Inspected native-size and enlarged versions on light and dark surfaces; no white canvas or white halo is visible.
- Cleared Chromium's browser cache, disabled cache and reloaded with `ignoreCache: true`. The resulting title is exactly `EduFusion`; the only active icon link is `/brand/edufusion-symbol-v2.ico`, returned as `image/x-icon` with HTTP 200. No obsolete icon reference remains in application metadata.

Inspected screenshots of the transparent auth logo, navbar/footer, toolkit peaks and intermediate states, mobile layouts, and audience/CTA transition. Local evidence remains in ignored `output/playwright/`, including `spotlight-final-*.png`, `spacing-final-*.png`, `favicon-v2-sizes.png` and browser result files. Generated build/QA outputs are excluded from Git.

Physical devices and deployed provider availability are not certified. This is a frontend refinement; backend contracts, authentication behavior, routes, dependencies and source artwork remain unchanged. The same PR stays open and unmerged.
