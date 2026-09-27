# EduFusion viewport and motion direction

Continuation of PR #5 on its existing branch. This brief supersedes the previous showcase-focused motion direction in response to the user's latest request.

## Section hierarchy

| Section | Purpose | Treatment |
| --- | --- | --- |
| Hero | One connected learning ecosystem | Four upright tool links move on a quiet 28-second ellipse around the approved mark; pause on hover, focus, manual request and when offscreen |
| Your toolkit | Main scroll narrative | EduPredict, LectureScribe, Academic Chatbot and Quiz Generator progressively take focus, then settle into the complete toolkit |
| Concept film | Supporting explanation | Static composition; video starts only on request and stops offscreen |
| Remaining sections | Relevance, trust and next action | Readable document flow and height-aware spacing |
| Footer | Deliberate conclusion | Compact transparent mark and wordmark with a separate tagline |

## Adapted Scroll Craft methodology

Reference: https://github.com/nateherkai/scroll-craft, including its actual SKILL.md and taste, feel, hero-depth, devices, approved-collection and verification references. The installed and repository SKILL.md hashes match. Apply this methodology to the existing product: preserve its page sequence, typography, colors, official artwork, concepts and functional routes.

The toolkit uses a contextual left column and a complete, readable two-by-two card composition. Scroll progressively changes card emphasis through restrained translation, scale and border opacity, accompanied by the matching numbered step. A 640px progression covers the four tools and final assembly. Only pin when the whole stage fits beneath the header; short screens, tablets and phones use normal document flow. Never intercept wheel events, snap or conceal card text and links. Reduced motion shows the complete stable composition.

Orbit geometry reserves room for the complete labels, logo and surrounding UI. Animate transforms through the Web Animations API; calculate geometry only on resize. Mobile uses stable tool chips. Toolkit updates use passive scroll listeners and one scheduled animation frame with grouped geometry reads. Neither effect installs a new animation framework.

## Viewport composition

Desktop authentication owns one viewport. Login uses responsive vertical density to keep branding, four features, footer, form and CTA visible at common laptop heights. Registration keeps the branding pane stable while its longer form scrolls independently. Both sections return to normal document flow below the desktop breakpoint, with the form first. Very short desktop windows retain scroll access rather than clipping content.

## Brand preparation

Use the original supplied artwork's transparent RGBA derivatives, cropped to their actual nontransparent bounds with a small edge allowance. Preserve all existing artwork pixels. Fresh `-alpha.png` filenames prevent reuse of the earlier opaque URLs by asset caches. Header and footer branding have transparent computed backgrounds. The pale contrast container on the dark authentication panel is authored in CSS, independently of the image.

Verification records are in `viewport-motion-2026-09-27.md`.
