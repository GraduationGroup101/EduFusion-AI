# Branded loading states

Date: 2026-09-30. Scope: whole-view loading states in the frontend. No backend, route, asset or dependency changes.

## Old identity found

The repository no longer contains any old logo file: `frontend/public/brand/` holds only the approved transparent `-alpha.png` crops and the `edufusion-symbol-v2.ico` favicon (`edufusion-logo.png`, the opaque PNG/WebP set and `favicon.png` were removed in earlier passes, see `final-ui-quality-2026-09-27.md` and `brand-spotlight-2026-09-27.md`). What remained was pre-brand placeholder UI in loading states:

| Where | Before | Kind of loading |
| --- | --- | --- |
| `ProtectedRoute` (session check on every protected page and refresh) | Teal rounded box with a generic `Brain` icon, the old orange `pulse-glow` ring, three blinking dots | Whole view |
| `App` Suspense fallback (first lazy chunk) | Plain "Loading page…" text at the top-left of an empty page; inside the workspace it also dropped the sidebar and header | Whole view |
| `AdminPages` chatbot administration Suspense | Plain "Loading academic chatbot…" | Whole panel |
| `tailwind.config.js` | `pulseGlow` keyframe using the old orange `rgba(255,87,34)` | Unused after the change |

Small contextual loaders were kept as they are: button spinners (`Loader2`, `RefreshCw`), the chatbot typing dots and "waking up" note, table "Loading results…" and "Loading clocks…" rows, "Loading your conversation…", "Loading saved lecture…", and the Oral Exam "Loading your exam workspace…" line.

## Canonical asset

`/brand/edufusion-mark-alpha.png` through the existing `BrandMark` component in `frontend/src/components/Brand.jsx`, the same mark the sidebar, header, landing page and chatbot use. No new artwork was generated.

## Loader component

`frontend/src/components/ui/BrandedLoader.jsx` renders the mark, three teal dots and a label.

- `variant="screen"` fills the viewport on the page background (session check, first app chunk); `variant="panel"` sits inside the current content area (workspace page transitions, admin chatbot).
- `role="status"`, `aria-live="polite"` and `aria-label` from the label; the mark is decorative (`alt=""`). No SVG icon.
- Motion is a 2.4 s breathing scale of 3% on the mark and a 1.2 s opacity pulse on the dots. Under `prefers-reduced-motion: reduce` both animations are removed and the dots are static.
- Sizes use `clamp()` so it works from phone width up; styles live in `index.css` next to the other shared components.

`DashboardLayout` now wraps its `Outlet` in its own `Suspense` with the panel loader labelled after the destination page ("Loading EduPredict"), so navigating between lazy pages never drops the sidebar and header.

## Files changed

- New: `frontend/src/components/ui/BrandedLoader.jsx`, `frontend/src/test/BrandedLoader.test.jsx`
- `frontend/src/components/auth/ProtectedRoute.jsx`, `frontend/src/App.jsx`, `frontend/src/components/layout/DashboardLayout.jsx`, `frontend/src/pages/AdminPages.jsx`
- `frontend/src/index.css`, `frontend/tailwind.config.js`
- `frontend/src/test/ProtectedRoute.test.jsx`

## Verification

- ESLint clean; Vitest 74 passed (14 files); production build passed.
- Production build served locally against a fixture mock of the gateway: landing, login, register, dashboard, EduPredict (student page and admin search), LectureScribe, Academic Chatbot, Quiz Generator, Oral Exam, At-Risk Students, Academic Clock, chatbot administration, and the protected-route transition with a delayed session check, which showed the branded loader and then the workspace. No console errors. No old icon, old orange glow or plain "Loading page…" fallback remains in `frontend/src`.
