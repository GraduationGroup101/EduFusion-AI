# EduFusion viewport and motion direction

Continuation of PR #5 on its existing branch. This brief supersedes the previous showcase-focused motion direction in response to the user's latest request.

## Section hierarchy

| Section | Purpose | Treatment |
| --- | --- | --- |
| Hero | One connected learning ecosystem | Four upright tool links move on a quiet 28-second ellipse around the approved mark; pause on hover/focus and when offscreen, without a visible control |
| Your toolkit | Main scroll narrative | One physical card comes forward from a layered deck at a time, then all four spread into the complete toolkit |
| Concept film | Supporting explanation | Static composition; video starts only on request and stops offscreen |
| Remaining sections | Relevance, trust and next action | Readable document flow and height-aware spacing |
| Footer | Deliberate conclusion | Compact transparent mark and wordmark with a separate tagline |

## Adapted Scroll Craft methodology

Reference: https://github.com/nateherkai/scroll-craft, including its actual SKILL.md and taste, feel, hero-depth, devices, approved-collection and verification references. The installed and repository SKILL.md hashes match. Apply this methodology to the existing product: preserve its page sequence, typography, colors, official artwork, concepts and functional routes.

The toolkit uses a contextual left column and a layered deck of the same four cards. EduPredict, LectureScribe, Academic Chatbot and Quiz Generator each become the single front-facing spotlight. Native scroll continuously moves and scales the physical cards between depth positions; it never swaps slide content. An 840px progression covers the four tools and the final spread into a two-by-two composition. Concealed faces stay quiet while the front card remains readable through each handoff. Keyboard focus immediately exposes the stationary complete grid so every link remains usable. Only pin when the whole stage fits beneath the header; short screens, tablets and phones use normal document flow. Never intercept wheel events or snap. Reduced motion shows the complete stable composition.

Orbit geometry reserves room for the complete labels, logo and surrounding UI. Animate transforms through the Web Animations API; calculate geometry only on resize. Mobile uses stable tool chips. Toolkit updates use passive scroll listeners and one scheduled animation frame with grouped geometry reads. Neither effect installs a new animation framework.

## Viewport composition

Desktop authentication owns one viewport. Login uses responsive vertical density to keep branding, four features, footer, form and CTA visible at common laptop heights. Registration keeps the branding pane stable while its longer form scrolls independently. Both sections return to normal document flow below the desktop breakpoint, with the form first. Very short desktop windows retain scroll access rather than clipping content.

The landing navbar is 80px tall on desktop and 68px on mobile, with a slightly smaller official logo and unchanged 44px controls. The audience columns use aligned rules and a shared 48px transition into the next CTA (44px on narrow mobile). Spacing is owned by the adjoining sections rather than accumulating two full section paddings.

## Brand preparation

Use the original supplied artwork's transparent RGBA derivatives, cropped to their actual nontransparent bounds with a small edge allowance. Preserve all existing artwork pixels. Fresh `-alpha.png` filenames prevent reuse of the earlier opaque URLs by asset caches. All brand wrappers and images have transparent computed backgrounds. Remove both the authentication contrast box and the chatbot logo tile.

The favicon is a single multi-resolution ICO with 16, 32 and 48px transparent symbol-only PNG frames. Premultiplied-alpha Lanczos resizing preserves edge colors without a white matte; the original symbol proportions are centered in each square. Use the new `edufusion-symbol-v2.ico` URL, remove the old favicon asset/reference, and set the exact document title to `EduFusion`. There is no web manifest or PWA icon set in this Vite project.

Verification records are in `brand-spotlight-2026-09-27.md` and the earlier `viewport-motion-2026-09-27.md`.
