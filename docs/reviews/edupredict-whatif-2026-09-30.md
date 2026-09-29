# EduPredict What-if scenario review

Date: 2026-09-30. Scope: the student EduPredict page, the gateway's scenario routes and store, and the EduPredict `scenario-prediction` contract. Model semantics are unchanged.

## 1. Problems with the previous UX

- The form exposed the model's inputs almost verbatim: "Extra Quiz Activity", "TMA Late Days", "CMA Score", "Add a New Submission". A student had to know what a VLE interaction is, what TMA and CMA mean, and that "late days" is counted from the due date.
- Limits were shown as raw numbers ("Highest allowed now: 3050 interactions"). Nothing told the student what a reasonable number was, so they had to invent increments themselves.
- All eleven fields were visible at once, including disabled ones, and the current real value was only visible in the summary strip above, never next to the field it related to.
- Results were two unrelated cards. "Actual 92.0%" and "Hypothetical 48.6%" were far apart on the page with no difference shown, and the actual card sat below the hypothetical one.
- There was no way to delete a saved scenario; a scenario could only be overwritten.
- A scenario saved on an earlier course day surfaced as a generic error toast ("Course day changed") with no explanation and no path forward. A scenario that referenced an assessment which had since been submitted looked identical to a service outage.

## 2. New UX

The page is now ordered: course and today's records, the **actual academic prediction**, the **what-if builder**, then the **saved scenario, comparison, hypothetical result and plan**.

The builder has three plain-language sections, each with a one-sentence explanation and a "Now:" line showing the real value:

1. **Study activity**: "No change / A little more / Moderately more / Much more / Custom". A preset scales the student's own activity (25%, 50% or 100% of their current interactions, floor 40) and keeps their existing quiz/forum/materials mix, spread over the last 7, 14 or 21 days. The scenario line reads "+78 interactions spread over the last 7 days (quizzes +22 · forums +15 · study materials +41)". Custom shows four numeric fields with short "Up to N" hints and starts from the "a little more" values, never from zeros.
2. **Latest graded work**: per submitted assessment type, "Keep 48 / Try a different score" (slider plus exact field) and "Keep current / On time / 1–2 days late / 3–5 days late / Custom". Timing options that are impossible on the current course day are disabled with a reason.
3. **Missed assessment**: appears only when an assessment is due and unsubmitted. "Leave it unsubmitted / Add a submission", then a score slider and the same timing choices.

A live "Your scenario" summary lists every change as "current → scenario" ("Latest TMA score 48 → 75", "Latest TMA submitted 2 days late → on time"). Save is disabled until at least one change exists. Controls are radio groups inside fieldsets, so keyboard and screen-reader use is standard; everything wraps to one column on phones. Raw field names never appear.

The saved scenario section shows the same change list, a status badge, and the actions. The **comparison** card shows "Current risk 92.0% (High) · Scenario risk 59.7% (Medium) · Change ↓ 32.3 points" with the sentence "If your academic evidence looked like this scenario, the model would estimate a 59.7% risk instead of 92.0%. This is a model estimate for a hypothetical situation, not a promise about what will happen." The actual card is teal and labelled "From real records"; the hypothetical card is dashed coral and labelled "Hypothetical".

## 3. Data-flow changes

- Saving a scenario now stores an `evidence` snapshot (clicks, active days, submissions, latest and next assessment ids and dates) beside `inputs`, `activity` and `based_on_day`. The payload sent to EduPredict is unchanged.
- `GET /scenarios/:id` returns `status` (`current`, `needs_reevaluation`, `stale`, `invalid`, with reasons) computed against the enrollment's current records.
- `GET /scenarios/:id/prediction` refuses `stale` and `invalid` scenarios with `409 {error, status}` before contacting the model; an upstream `422` is reported as `invalid`. Usable results carry `status` too.
- `DELETE /scenarios/:id` and `PATCH /scenarios/:id/plan` are new. Both resolve the enrollment through the authenticated student's own rows.
- The frontend derives the controls from the saved inputs (`formFromInputs`) and the payload from the controls (`buildPayload`) in `frontend/src/lib/scenario.js`, so the builder, the summary, the dialog and the plan all describe the same thing.

## 4. Delete scenario

"Delete scenario" opens an accessible confirmation (`role="dialog"`, focus moved in, Tab contained, Escape and backdrop cancel, focus returned) that lists the changes being discarded and states that only the saved scenario is removed. On confirm the gateway deletes the single `edufusion_student_scenarios` row for `(id_student, enrollment_id)`; the UI clears the saved scenario, comparison and hypothetical result and resets the controls. The actual prediction is neither refetched nor changed. A foreign enrollment id returns `404` and touches nothing.

## 5. Decision on "Save as actual"

**Not implemented for students.** The environment is treated as **A: source-of-truth academic data**.

Evidence:

- `students`, `enrollments`, `student_vle_events`, `student_assessments` and `predictions` are the shared EduPredict tables. The README and deployment notes call them "source academic records", forbid editing grades or prediction records in migrations, and the rollback guidance is to "keep source academic records intact".
- The only demo affordance is `backend/scripts/seed.js`, which creates one demo course and an administrator, refuses to run in production, and does not create student evidence. EduPredict's `demo_enrollments` table selects which enrollments a batch run covers; it does not mark evidence as simulated.
- Roles are `admin`, `advisor` and `student`. No role, flag or environment variable marks a deployment as a simulation, and there is no per-student demo mode.
- Admin controls move the academic clock (time) and regenerate predictions; no existing control writes grades, submissions or activity, and no upstream endpoint accepts such writes.
- Students self-register and authenticate with a PIN; a student-facing write to evidence would let any student edit their own grades.

The safe alternative is **"Use as my learning plan"**: the saved scenario is labelled with `plan.adopted_at` and shown as forward-looking targets ("Aim for 75 or more on your next TMA", "Submit your next TMA on time", "Add about 78 interactions over the next 7 days"). It writes only to the gateway-owned scenario row.

If a controlled demo mode is wanted later, it should be an admin-only operation behind an explicit environment flag that rewrites the underlying VLE events and assessments in one transaction, records provenance, recomputes the actual prediction from the modified evidence, and has a rollback path. Writing a scenario probability into `predictions` without the evidence would break prediction integrity and is deliberately not offered.

## 6. Safety reasoning

- Actual and hypothetical results come from different endpoints and are stored in different state; the comparison reads both but writes neither.
- Stale and invalid scenarios are never sent to the model. The old day is never reused silently; the student sees why and can update, rebuild or delete.
- Ownership is enforced in the SQL of every scenario write and in the enrollment lookup of every route.
- The learning plan and delete operations touch only `edufusion_student_scenarios`.

## 7. Files changed

- `backend/src/db/scenarios.js`: evidence snapshot, `scenarioStatus`, `deleteScenario`, `setScenarioPlan`.
- `backend/src/routes/student.js`: status on read and evaluation, `DELETE`, `PATCH .../plan`, shared owned-enrollment lookup.
- `backend/test/platform.test.js`: delete/ownership/plan test and stale/invalid/needs-reevaluation test.
- `frontend/src/lib/scenario.js`: presets, form/payload mapping, wording, comparison helpers.
- `frontend/src/components/edupredict/ScenarioBuilder.jsx`, `ScenarioResults.jsx`, `frontend/src/components/ui/ConfirmDialog.jsx`: new components.
- `frontend/src/pages/StudentPredictionPage.jsx`: rebuilt page.
- `frontend/src/services/api.js`: `deleteScenario`, `setScenarioPlan`.
- `frontend/src/index.css`: builder, segmented control, comparison, banner and dialog styles.
- `frontend/src/test/StudentPredictionPage.test.jsx`, `frontend/src/test/scenario.test.js`: tests.
- `docs/api-contracts.md`, `README.md`, this review.

## 8. Tests and results

`npm run check` (ESLint, backend tests, frontend tests, production build): passed.

| Suite | Result |
| --- | --- |
| Backend (`node --test`, PGlite) | 81 passed |
| Frontend (Vitest) | 64 passed |
| Build | passed |

Backend coverage added: owner-only delete and plan, `404` for a foreign enrollment, records and prediction history unchanged after delete, `stale` after the clock moves (no upstream call), `invalid` when a newer submission replaces the referenced one (no upstream call), `needs_reevaluation` after new real activity (evaluated, flagged), snapshot refresh on re-save, legacy rows without a snapshot.

Frontend coverage added: preset scenario and comparison rendering, custom values with clamping and no raw field names, missed-assessment gating and timing, loading a saved scenario into the controls, delete with cancel/confirm and untouched actual prediction, stale (not evaluated, update to today), invalid (reasons, no evaluation), evaluation `409` shown as a state, needs-reevaluation, learning plan toggle, course switching resets controls and ignores late responses, evaluation outage handling, gateway error passthrough.

## 9. Browser QA

The Vite dev server was driven in the desktop app's browser against a local mock of the gateway contract (fixtures only, no database). Checked at 1280×900 and 375×812: builder presets and custom controls, summary, save and comparison, hypothetical card, learning plan adopt/remove, delete confirmation with Escape, stale and invalid states, and one-column mobile layout without horizontal overflow. Screenshots were shared with the pull request; they are QA artifacts and are not committed.
