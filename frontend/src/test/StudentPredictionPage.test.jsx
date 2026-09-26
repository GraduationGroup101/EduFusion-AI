import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import StudentPredictionPage from '../pages/StudentPredictionPage';
import { studentService } from '../services/api';

vi.mock('../services/api', () => ({ studentService: {
  getPredictionData: vi.fn(), getPrediction: vi.fn(), getScenario: vi.fn(), saveScenario: vi.fn(),
} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
const course = (id) => ({ enrollment_id: id, code_module: `Course${id}`, code_presentation: '2026', current_day: 60,
  total_clicks: 5, active_days: 1, num_submitted: 1, latest_tma_id: 1, latest_tma_score: 50,
  latest_tma_due_date: 30, next_cma_assessment_id: 2, next_cma_due_date: 90 });
const prediction = (risk) => ({ risk_level: risk, risk_probability: 0.3, explanation: [], cached: true });
const scenario = (message) => ({ message, projected: { total_clicks: 10, latest_tma_score: 80 }, based_on_day: 60 });
beforeEach(() => {
  studentService.getPredictionData.mockResolvedValue({ data: { enrollments: [course(1), course(2)] } });
  studentService.getScenario.mockResolvedValue({ data: { scenario: null } });
  studentService.getPrediction.mockResolvedValue({ data: prediction('Actual risk') });
});

it('saves separate scenario inputs and preserves the actual prediction', async () => {
  studentService.saveScenario.mockResolvedValue({ data: { scenario: scenario('Separate scenario') } });
  render(<StudentPredictionPage />);
  await screen.findByText('Actual risk');
  expect(screen.getByText(/Future submissions become available/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('TMA Score'), { target: { value: '80' } });
  fireEvent.click(screen.getByText('Save Scenario'));
  await screen.findByText('Separate scenario');
  expect(studentService.saveScenario).toHaveBeenCalledWith(1, expect.objectContaining({ latest_tma_score: 80 }));
  expect(studentService.getPrediction).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Actual risk')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Saved scenario' })).getByText('80')).toBeInTheDocument();
});

it('ignores late predictions and scenarios after switching courses', async () => {
  let resolvePrediction, resolveScenario;
  studentService.getPrediction.mockImplementationOnce(() => new Promise((resolve) => { resolvePrediction = resolve; }));
  studentService.getScenario.mockImplementationOnce(() => new Promise((resolve) => { resolveScenario = resolve; }));
  render(<StudentPredictionPage />);
  await waitFor(() => expect(studentService.getPrediction).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText('Course'), { target: { value: '2' } });
  await screen.findByText('Actual risk');
  await act(async () => {
    resolvePrediction({ data: prediction('Wrong course risk') });
    resolveScenario({ data: { scenario: { data: scenario('Wrong course scenario') } } });
  });
  expect(screen.queryByText('Wrong course risk')).not.toBeInTheDocument();
  expect(screen.queryByText('Wrong course scenario')).not.toBeInTheDocument();
  expect(studentService.getPrediction.mock.calls[0][1].signal.aborted).toBe(true);
});
