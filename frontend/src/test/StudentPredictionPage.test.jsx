import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import StudentPredictionPage from '../pages/StudentPredictionPage';
import { studentService } from '../services/api';
import toast from 'react-hot-toast';

vi.mock('../services/api', () => ({ studentService: {
  getPredictionData: vi.fn(), getPrediction: vi.fn(), getScenario: vi.fn(), saveScenario: vi.fn(), getScenarioPrediction: vi.fn(),
  deleteScenario: vi.fn(), setScenarioPlan: vi.fn(),
} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const course = (id, overrides = {}) => ({ enrollment_id: id, code_module: `Course${id}`, code_presentation: '2026', current_day: 60,
  total_clicks: 100, quiz_clicks: 30, forumng_clicks: 30, resource_clicks: 40, active_days: 10, days_since_last_click: 3, num_submitted: 1,
  avg_score: 50, submission_rate: 0.5, avg_days_late: 2,
  latest_tma_id: 1, latest_tma_score: 50, latest_tma_due_date: 30, latest_tma_date_submitted: 32,
  next_cma_assessment_id: 2, next_cma_due_date: 90, ...overrides });
const prediction = (risk) => ({ risk_level: risk, risk_probability: 0.3, at_risk: 0, explanation: ['few interactions'], cached: true });
const littleInputs = { quiz_clicks: 8, forum_clicks: 8, resource_clicks: 9, activity_days: 7 };
const saved = (inputs = { ...littleInputs, latest_tma_score: 80 }, extra = {}) => ({
  inputs, based_on_day: 60, plan: null, projected: { total_clicks: 125, latest_tma_score: 80 }, message: 'Scenario saved separately.', ...extra,
});
const status = (state, extra = {}) => ({ state, reasons: [], based_on_day: 60, current_day: 60, ...extra });
const hypothetical = (probability = 0.1, extra = {}) => ({ risk_level: 'LOW', risk_probability: probability, at_risk: 0, based_on_day: 60, explanation: ['scenario reason'], hypothetical: true, status: status('current'), ...extra });
const comparison = () => screen.getByRole('region', { name: 'Scenario comparison' });

beforeEach(() => {
  studentService.getPredictionData.mockResolvedValue({ data: { enrollments: [course(1), course(2, { next_tma_assessment_id: 3, next_tma_due_date: 40 })] } });
  studentService.getScenario.mockResolvedValue({ data: { scenario: null, status: null } });
  studentService.getPrediction.mockResolvedValue({ data: prediction('Actual risk') });
  studentService.saveScenario.mockResolvedValue({ data: { scenario: saved() } });
  studentService.getScenarioPrediction.mockResolvedValue({ data: hypothetical() });
  studentService.deleteScenario.mockResolvedValue({ data: { deleted: true } });
  studentService.setScenarioPlan.mockImplementation((id, adopted) => Promise.resolve({ data: { scenario: saved(undefined, { plan: adopted ? { adopted_at: '2026-09-30T08:00:00.000Z' } : null }), message: adopted ? 'Saved as your learning plan.' : 'Learning plan removed.' } }));
});

it('builds a simple scenario from a preset and shows actual and scenario results separately', async () => {
  studentService.saveScenario.mockResolvedValue({ data: { scenario: saved(littleInputs) } });
  render(<StudentPredictionPage />);
  await screen.findByText('Actual risk');
  expect(screen.getByText('Save & evaluate scenario').closest('button')).toBeDisabled();
  expect(screen.getByText(/Choose at least one change/)).toBeInTheDocument();
  expect(screen.getByText(/Now: 100 interactions on 10 active days, last active 3 days ago/)).toBeInTheDocument();
  expect(screen.getByText(/No missed assessments right now/)).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('A little more'));
  expect(screen.getByText(/\+25 interactions over the last 7 days \(quizzes \+8 · forums \+8 · study materials \+9\)/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Save & evaluate scenario'));
  await screen.findByRole('region', { name: 'Scenario comparison' });
  expect(studentService.saveScenario).toHaveBeenCalledWith(1, littleInputs);
  expect(studentService.getScenarioPrediction).toHaveBeenCalledWith(1, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(studentService.getPrediction).toHaveBeenCalledTimes(1);
  expect(within(comparison()).getByText('Current risk')).toBeInTheDocument();
  expect(within(comparison()).getByText('30.0%')).toBeInTheDocument();
  expect(within(comparison()).getByText('Scenario risk')).toBeInTheDocument();
  expect(within(comparison()).getByText('10.0%')).toBeInTheDocument();
  expect(within(comparison()).getByText('20 points')).toBeInTheDocument();
  expect(within(comparison()).getByText(/estimates a lower risk/)).toBeInTheDocument();
  expect(within(comparison()).getByText(/If your academic evidence looked like this scenario, the model would estimate a 10.0% risk instead of 30.0%/)).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Actual academic prediction' })).getByText('30.0%')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Hypothetical scenario prediction' })).getByText('10.0%')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Hypothetical scenario prediction' })).getByText('scenario reason')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Saved scenario' })).getByText('Current')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Actual academic prediction' })).getByText('Actual risk')).toBeInTheDocument();
  expect(toast.success).toHaveBeenCalledWith('Scenario saved. Your academic records are unchanged.');
});

it('supports custom activity, a different latest score and on-time timing without exposing raw fields', async () => {
  render(<StudentPredictionPage />);
  await screen.findByText('Actual risk');
  expect(screen.getByText((_, node) => node.tagName === 'P' && node.textContent === 'Now: scored 50 out of 100, submitted 2 days late (day 32, due day 30).')).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('region', { name: 'Study activity' })).getByLabelText('Custom'));
  expect(screen.getByLabelText(/Extra quiz interactions/)).toHaveValue(8);
  fireEvent.change(screen.getByLabelText(/Extra quiz interactions/), { target: { value: '12' } });
  fireEvent.change(screen.getByLabelText(/Spread over the last \(days\)/), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText(/Extra forum interactions/), { target: { value: '99999' } });
  expect(screen.getByLabelText(/Extra forum interactions/)).toHaveValue(3050);
  fireEvent.click(screen.getByLabelText('Try a different score'));
  fireEvent.change(screen.getByLabelText('Scenario TMA score (exact value)'), { target: { value: '80' } });
  expect(screen.getByLabelText('Scenario TMA score')).toHaveValue('80');
  fireEvent.click(screen.getByLabelText('On time'));
  expect(screen.getByText('Latest TMA score 50 → 80.')).toBeInTheDocument();
  expect(screen.getByText('Latest TMA submitted 2 days late → on time.')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Save & evaluate scenario'));
  await waitFor(() => expect(studentService.saveScenario).toHaveBeenCalledWith(1, {
    quiz_clicks: 12, forum_clicks: 3050, resource_clicks: 9, activity_days: 3, latest_tma_score: 80, tma_delay_days: 0,
  }));
  expect(screen.queryByText(/quiz_clicks|forumng|latest_tma_score/)).not.toBeInTheDocument();
});

it('offers a missed assessment only when it is due and sends its timing', async () => {
  render(<StudentPredictionPage />);
  await screen.findByText('Actual risk');
  fireEvent.change(screen.getByLabelText('Course'), { target: { value: '2' } });
  await screen.findByText(/Now: TMA due on day 40, not submitted/);
  const missed = screen.getByRole('region', { name: 'Missed assessment' });
  fireEvent.click(within(missed).getByLabelText('Add a submission'));
  fireEvent.change(within(missed).getByLabelText('Scenario TMA score (exact value)'), { target: { value: '70' } });
  fireEvent.click(within(missed).getByLabelText('3–5 days late'));
  expect(screen.getByText('Missed TMA (due day 40): unsubmitted → submitted 5 days late with a score of 70.')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Save & evaluate scenario'));
  await waitFor(() => expect(studentService.saveScenario).toHaveBeenCalledWith(2, expect.objectContaining({
    new_submission_type: 'TMA', new_submission_score: 70, new_submission_delay_days: 5,
  })));
});

it('loads a saved scenario into the controls and deletes it after confirmation without touching the actual prediction', async () => {
  studentService.getScenario.mockResolvedValue({ data: { scenario: { data: saved() }, status: status('current') } });
  render(<StudentPredictionPage />);
  await screen.findByRole('region', { name: 'Scenario comparison' });
  expect(screen.getByLabelText('A little more')).toBeChecked();
  expect(screen.getByLabelText('Try a different score')).toBeChecked();
  expect(screen.getByLabelText('Scenario TMA score')).toHaveValue('80');
  expect(within(screen.getByRole('region', { name: 'Saved scenario' })).getByText('Latest TMA score 50 → 80.')).toBeInTheDocument();
  const opener = screen.getByText('Delete scenario').closest('button');
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole('dialog', { name: 'Delete this what-if scenario?' });
  expect(within(dialog).getByText(/Only the saved scenario is removed/)).toBeInTheDocument();
  expect(within(dialog).getByText('Latest TMA score 50 → 80.')).toBeInTheDocument();
  expect(document.activeElement).toBe(within(dialog).getByText('Cancel'));
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(studentService.deleteScenario).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByText('Delete scenario').closest('button'));
  fireEvent.click(screen.getByText('Delete scenario'));
  fireEvent.click(within(await screen.findByRole('dialog')).getByText('Delete scenario'));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Saved scenario' })).not.toBeInTheDocument());
  expect(studentService.deleteScenario).toHaveBeenCalledWith(1);
  expect(screen.queryByRole('region', { name: 'Scenario comparison' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Hypothetical scenario prediction' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('No change')).toBeChecked();
  expect(screen.getByLabelText('Keep 50')).toBeChecked();
  expect(screen.getByLabelText('Keep current')).toBeChecked();
  expect(studentService.getPrediction).toHaveBeenCalledTimes(1);
  expect(within(screen.getByRole('region', { name: 'Actual academic prediction' })).getByText('30.0%')).toBeInTheDocument();
  expect(toast.success).toHaveBeenCalledWith('Scenario deleted. Your actual prediction is unchanged.');
});

it('shows a stale scenario without evaluating it and updates it to the current day', async () => {
  studentService.getScenario.mockResolvedValue({ data: { scenario: { data: saved(undefined, { based_on_day: 58 }) },
    status: status('stale', { based_on_day: 58, reasons: ['This scenario was built on course day 58. The course is now on day 60.'] }) } });
  render(<StudentPredictionPage />);
  await screen.findByText('This scenario is out of date');
  expect(screen.getByText('Out of date')).toBeInTheDocument();
  expect(screen.getByText('This scenario was built on course day 58. The course is now on day 60.')).toBeInTheDocument();
  expect(studentService.getScenarioPrediction).not.toHaveBeenCalled();
  expect(screen.queryByRole('region', { name: 'Scenario comparison' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Hypothetical scenario prediction' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Update to day 60'));
  await screen.findByRole('region', { name: 'Scenario comparison' });
  expect(studentService.saveScenario).toHaveBeenCalledWith(1, saved().inputs);
  expect(studentService.getScenarioPrediction).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Current')).toBeInTheDocument();
  expect(studentService.getPrediction).toHaveBeenCalledTimes(1);
});

it('shows an invalid scenario with its reasons and never evaluates it', async () => {
  studentService.getScenario.mockResolvedValue({ data: { scenario: { data: saved() },
    status: status('invalid', { reasons: ['The unsubmitted TMA in this scenario has since been submitted.'] }) } });
  render(<StudentPredictionPage />);
  await screen.findByText('This scenario no longer applies');
  expect(screen.getByText('The unsubmitted TMA in this scenario has since been submitted.')).toBeInTheDocument();
  expect(screen.getByText(/Build a new scenario above, or delete this one/)).toBeInTheDocument();
  expect(studentService.getScenarioPrediction).not.toHaveBeenCalled();
  expect(screen.queryByText(/Update to day/)).not.toBeInTheDocument();
  expect(screen.getByText('Delete scenario')).toBeInTheDocument();
  expect(screen.getByText('Actual risk')).toBeInTheDocument();
});

it('turns a conflict during evaluation into an invalid state instead of an outage message', async () => {
  studentService.getScenario.mockResolvedValue({ data: { scenario: { data: saved() }, status: status('current') } });
  studentService.getScenarioPrediction.mockRejectedValueOnce({ response: { status: 409, data: { error: 'Scenario evidence changed. Save the scenario again.',
    status: status('invalid', { reasons: ['The prediction model could not apply this scenario to your current records.'] }) } } });
  render(<StudentPredictionPage />);
  await screen.findByText('This scenario no longer applies');
  expect(screen.getByText('The prediction model could not apply this scenario to your current records.')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('flags changed records, still evaluates, and re-evaluates on request', async () => {
  studentService.getScenario.mockResolvedValue({ data: { scenario: { data: saved() },
    status: status('needs_reevaluation', { changed: ['total_clicks'], reasons: ['Your academic records changed since this scenario was saved, so its summary may be out of date.'] }) } });
  studentService.getScenarioPrediction.mockResolvedValueOnce({ data: hypothetical(0.1, { status: status('needs_reevaluation') }) });
  render(<StudentPredictionPage />);
  await screen.findByRole('region', { name: 'Scenario comparison' });
  expect(screen.getByText('Your records changed since this scenario was saved')).toBeInTheDocument();
  expect(screen.getByText('Records changed')).toBeInTheDocument();
  fireEvent.click(screen.getByText("Re-evaluate with today's records"));
  await waitFor(() => expect(studentService.saveScenario).toHaveBeenCalledWith(1, saved().inputs));
  await screen.findByText('Current');
  expect(studentService.getScenarioPrediction).toHaveBeenCalledTimes(2);
});

it('keeps a scenario as a learning plan without any save or prediction call', async () => {
  studentService.getScenario.mockResolvedValue({ data: { scenario: { data: saved() }, status: status('current') } });
  render(<StudentPredictionPage />);
  const plan = await screen.findByRole('region', { name: 'Learning plan' });
  expect(within(plan).getByText('Keep this as a plan')).toBeInTheDocument();
  expect(within(plan).getByText(/Saving or evaluating a scenario does not change your academic records/)).toBeInTheDocument();
  expect(within(plan).getByText('Add about 25 interactions over the next 7 days, roughly 4 a day (quizzes 8 · forums 8 · study materials 9).')).toBeInTheDocument();
  expect(within(plan).getByText('Aim for 80 or more on your next TMA.')).toBeInTheDocument();
  fireEvent.click(within(plan).getByText('Use as my learning plan'));
  await screen.findByText('Your learning plan');
  expect(studentService.setScenarioPlan).toHaveBeenCalledWith(1, true);
  expect(screen.getByText('Remove learning plan')).toBeInTheDocument();
  expect(screen.getByText('Adopted')).toBeInTheDocument();
  expect(studentService.saveScenario).not.toHaveBeenCalled();
  expect(studentService.getPrediction).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Remove learning plan'));
  await screen.findByText('Keep this as a plan');
  expect(studentService.setScenarioPlan).toHaveBeenLastCalledWith(1, false);
});

it('reruns only the actual prediction with force while preserving the scenario result', async () => {
  studentService.getScenario.mockResolvedValue({ data: { scenario: { data: saved() }, status: status('current') } });
  render(<StudentPredictionPage />);
  await screen.findByRole('region', { name: 'Scenario comparison' });
  fireEvent.click(screen.getByText('Rerun actual prediction'));
  await waitFor(() => expect(studentService.getPrediction).toHaveBeenCalledTimes(2));
  expect(studentService.getPrediction.mock.calls[1][0]).toMatchObject({ force: 1 });
  expect(studentService.getScenarioPrediction).toHaveBeenCalledTimes(1);
  expect(within(screen.getByRole('region', { name: 'Hypothetical scenario prediction' })).getByText('10.0%')).toBeInTheDocument();
});

it('shows a scenario evaluation failure without changing the actual prediction', async () => {
  studentService.getScenarioPrediction.mockRejectedValueOnce({ response: { data: { error: 'Scenario prediction service is temporarily unavailable.' } } });
  render(<StudentPredictionPage />);
  await screen.findByText('Actual risk');
  fireEvent.click(screen.getByLabelText('Moderately more'));
  fireEvent.click(screen.getByText('Save & evaluate scenario'));
  await screen.findByRole('alert');
  expect(screen.getByText('Actual risk')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Saved scenario' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Hypothetical scenario prediction' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Scenario comparison' })).not.toBeInTheDocument();
});

it('ignores late predictions and scenarios after switching courses and resets the controls', async () => {
  let resolvePrediction, resolveScenario;
  studentService.getPrediction.mockImplementationOnce(() => new Promise((resolve) => { resolvePrediction = resolve; }));
  studentService.getScenario.mockImplementationOnce(() => new Promise((resolve) => { resolveScenario = resolve; }));
  render(<StudentPredictionPage />);
  await waitFor(() => expect(studentService.getPrediction).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByLabelText('Much more'));
  fireEvent.change(screen.getByLabelText('Course'), { target: { value: '2' } });
  await screen.findByText('Actual risk');
  expect(screen.getByLabelText('No change')).toBeChecked();
  await act(async () => {
    resolvePrediction({ data: prediction('Wrong course risk') });
    resolveScenario({ data: { scenario: { data: saved() }, status: status('current') } });
  });
  expect(screen.queryByText('Wrong course risk')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Saved scenario' })).not.toBeInTheDocument();
  expect(studentService.getPrediction.mock.calls[0][1].signal.aborted).toBe(true);
});

it('ignores a late hypothetical result after switching courses', async () => {
  let resolveFirst;
  studentService.getScenario.mockResolvedValue({ data: { scenario: { data: saved() }, status: status('current') } });
  studentService.getScenarioPrediction.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
  render(<StudentPredictionPage />);
  await waitFor(() => expect(studentService.getScenarioPrediction).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText('Course'), { target: { value: '2' } });
  await screen.findByRole('region', { name: 'Scenario comparison' });
  await act(async () => resolveFirst({ data: hypothetical(0.9, { risk_level: 'HIGH' }) }));
  expect(screen.queryByText('90.0%')).not.toBeInTheDocument();
  expect(studentService.getScenarioPrediction.mock.calls[0][1].signal.aborted).toBe(true);
});

it('shows the safe prediction error returned by the gateway', async () => {
  studentService.getPrediction.mockRejectedValueOnce({ response: { data: { error: 'Prediction service is temporarily unavailable. Please try again.' } } });
  render(<StudentPredictionPage />);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Prediction service is temporarily unavailable. Please try again.'));
});

it('requires explicit confirmation before applying a scenario to actual data',async()=>{
  studentService.getScenario.mockResolvedValue({data:{scenario:{data:saved({latest_tma_score:90},{revision:'reviewed-version'})},status:status('current')}});
  studentService.applyScenarioActual=vi.fn().mockResolvedValue({data:{scenario:saved({latest_tma_score:90},{revision:'reviewed-version',applied_at:'2026-09-30'}),message:'Applied'}});
  render(<StudentPredictionPage/>);
  const apply=await screen.findByRole('button',{name:'Save as Actual'});
  expect(studentService.applyScenarioActual).not.toHaveBeenCalled();
  fireEvent.click(apply);fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  expect(studentService.applyScenarioActual).not.toHaveBeenCalled();
  fireEvent.click(apply);fireEvent.click(screen.getByRole('button',{name:'Apply to actual data'}));
  await waitFor(()=>expect(studentService.applyScenarioActual).toHaveBeenCalledWith(1,'reviewed-version'));
});
