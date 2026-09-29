import { describe, expect, it } from 'vitest';
import {
  activityFromPreset, buildPayload, compareRisk, defaultForm, describeChanges, describeLateness, formFromInputs,
  hasChanges, latestAssessment, maxExtraClicks, missingAssessment, missingAssessmentTypes, planSteps, presetForActivity, timingForDelay,
} from '../lib/scenario';

const course = (overrides = {}) => ({
  enrollment_id: 1, current_day: 60, total_clicks: 100, quiz_clicks: 30, forumng_clicks: 30, resource_clicks: 40, active_days: 10,
  latest_tma_id: 1, latest_tma_score: 50, latest_tma_due_date: 30, latest_tma_date_submitted: 32,
  next_cma_assessment_id: 2, next_cma_due_date: 90, ...overrides,
});

describe('activity presets', () => {
  it('scale the student\'s own activity and keep their mix', () => {
    expect(activityFromPreset(course(), 'little')).toEqual({ quiz_clicks: 8, forum_clicks: 8, resource_clicks: 9, activity_days: 7 });
    expect(activityFromPreset(course(), 'moderate')).toEqual({ quiz_clicks: 15, forum_clicks: 15, resource_clicks: 20, activity_days: 14 });
    expect(activityFromPreset(course(), 'much')).toEqual({ quiz_clicks: 30, forum_clicks: 30, resource_clicks: 40, activity_days: 21 });
    expect(activityFromPreset(course(), 'none')).toEqual({ quiz_clicks: 0, forum_clicks: 0, resource_clicks: 0, activity_days: 1 });
  });
  it('use a floor for quiet students and never exceed the course limit or elapsed days', () => {
    const quiet = course({ total_clicks: 0, quiz_clicks: 0, forumng_clicks: 0, resource_clicks: 0 });
    expect(activityFromPreset(quiet, 'little')).toEqual({ quiz_clicks: 3, forum_clicks: 3, resource_clicks: 4, activity_days: 7 });
    const early = course({ current_day: 0, total_clicks: 100000, quiz_clicks: 100000, forumng_clicks: 0, resource_clicks: 0 });
    expect(maxExtraClicks(early)).toBe(50);
    expect(activityFromPreset(early, 'much')).toEqual({ quiz_clicks: 50, forum_clicks: 0, resource_clicks: 0, activity_days: 1 });
  });
  it('are recognised from saved inputs', () => {
    for (const id of ['little', 'moderate', 'much']) expect(presetForActivity(course(), activityFromPreset(course(), id))).toBe(id);
    expect(presetForActivity(course(), { quiz_clicks: 0, forum_clicks: 0, resource_clicks: 0, activity_days: 4 })).toBe('none');
    expect(presetForActivity(course(), { quiz_clicks: 12, forum_clicks: 8, resource_clicks: 9, activity_days: 7 })).toBe('custom');
  });
});

describe('assessment helpers', () => {
  it('describe the latest submitted work and the possible delay window', () => {
    expect(latestAssessment(course(), 'tma')).toEqual({ type: 'tma', score: 50, due: 30, submitted: 32, lateDays: 2, maxDelay: 30 });
    expect(latestAssessment(course(), 'cma')).toBeNull();
    expect(describeLateness(2)).toBe('2 days late');
    expect(describeLateness(0)).toBe('on time');
    expect(describeLateness(-1)).toBe('1 day early');
    expect(describeLateness(null)).toBe('timing unknown');
  });
  it('only offer a missed assessment once it is due', () => {
    expect(missingAssessment(course(), 'CMA')).toBeNull();
    expect(missingAssessmentTypes(course())).toEqual([]);
    const overdue = course({ next_tma_assessment_id: 3, next_tma_due_date: 40 });
    expect(missingAssessment(overdue, 'TMA')).toEqual({ type: 'tma', due: 40, maxDelay: 20 });
    expect(missingAssessmentTypes(overdue)).toEqual(['TMA']);
  });
  it('map delays to timing choices', () => {
    expect(timingForDelay(undefined)).toBe('keep');
    expect(timingForDelay(0)).toBe('on_time');
    expect(timingForDelay(2)).toBe('late_2');
    expect(timingForDelay(5)).toBe('late_5');
    expect(timingForDelay(3)).toBe('custom');
  });
});

describe('form and payload', () => {
  it('round-trips saved inputs through the controls', () => {
    const inputs = { quiz_clicks: 8, forum_clicks: 8, resource_clicks: 9, activity_days: 7, latest_tma_score: 80, tma_delay_days: 3 };
    const form = formFromInputs(course(), inputs);
    expect(form.activityPreset).toBe('little');
    expect(form.tma).toEqual({ scoreMode: 'change', score: 80, timing: 'custom', delay: 3 });
    expect(buildPayload(form, course())).toEqual(inputs);
  });
  it('drops assessment changes that no longer have a target and ignores an unavailable submission', () => {
    const inputs = { quiz_clicks: 0, forum_clicks: 0, resource_clicks: 0, activity_days: 1, latest_tma_score: 80, new_submission_type: 'CMA', new_submission_score: 70 };
    const row = course({ latest_tma_id: null });
    expect(buildPayload(formFromInputs(row, inputs), row)).toEqual({ quiz_clicks: 0, forum_clicks: 0, resource_clicks: 0, activity_days: 1 });
  });
  it('sends a missed submission with its timing', () => {
    const row = course({ next_tma_assessment_id: 3, next_tma_due_date: 40 });
    const form = { ...defaultForm(row), submission: { enabled: true, type: 'TMA', score: 70, timing: 'late_5', delay: 0 } };
    expect(buildPayload(form, row)).toMatchObject({ new_submission_type: 'TMA', new_submission_score: 70, new_submission_delay_days: 5 });
  });
  it('knows when nothing has changed', () => {
    expect(hasChanges({ quiz_clicks: 0, forum_clicks: 0, resource_clicks: 0, activity_days: 5 })).toBe(false);
    expect(hasChanges({ quiz_clicks: 1, forum_clicks: 0, resource_clicks: 0, activity_days: 1 })).toBe(true);
    expect(hasChanges({ quiz_clicks: 0, forum_clicks: 0, resource_clicks: 0, activity_days: 1, tma_delay_days: 0 })).toBe(true);
  });
});

describe('wording', () => {
  it('describes changes as current → scenario in plain language', () => {
    const row = course({ next_tma_assessment_id: 3, next_tma_due_date: 40 });
    const payload = { quiz_clicks: 8, forum_clicks: 8, resource_clicks: 9, activity_days: 7, latest_tma_score: 80, tma_delay_days: 0,
      new_submission_type: 'TMA', new_submission_score: 70, new_submission_delay_days: 5 };
    expect(describeChanges(payload, row)).toEqual([
      '+25 interactions over the last 7 days (quizzes +8 · forums +8 · study materials +9); now 100 in total.',
      'Latest TMA score 50 → 80.',
      'Latest TMA submitted 2 days late → on time.',
      'Missed TMA (due day 40): unsubmitted → submitted 5 days late with a score of 70.',
    ]);
  });
  it('turns a scenario into forward-looking targets without touching records', () => {
    expect(planSteps({ quiz_clicks: 8, forum_clicks: 8, resource_clicks: 9, activity_days: 7, latest_tma_score: 80, tma_delay_days: 0, new_submission_type: 'TMA', new_submission_score: 70 }, course())).toEqual([
      'Add about 25 interactions over the next 7 days, roughly 4 a day (quizzes 8 · forums 8 · study materials 9).',
      'Aim for 80 or more on your next TMA.',
      'Submit your next TMA on time.',
      'Submit the missed TMA as soon as you can, aiming for 70.',
    ]);
    expect(planSteps({ latest_tma_score: 40 }, course())).toEqual([]);
  });
  it('compares risks in points without implying causality', () => {
    expect(compareRisk(0.92, 0.486)).toEqual({ points: 43.4, direction: 'lower' });
    expect(compareRisk(0.3, 0.45)).toEqual({ points: 15, direction: 'higher' });
    expect(compareRisk(0.3, 0.3)).toEqual({ points: 0, direction: 'same' });
    expect(compareRisk(null, 0.3)).toBeNull();
  });
});
