import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AtRiskStudentsPage, AcademicClockPage } from '../pages/AdminPages';
import { adminService } from '../services/api';
import StatusBadge from '../components/ui/StatusBadge';

vi.mock('../services/api', () => ({ adminService: {
  getAtRiskStudents: vi.fn(), getClocks: vi.fn(), tickAllClocks: vi.fn(), resetAllClocks: vi.fn(), runDemoPredictions: vi.fn(),
} }));
beforeEach(() => {
  adminService.getAtRiskStudents.mockResolvedValue({ data: { students: Array.from({ length: 32 }, (_, i) => ({
    enrollment_id: i, id_student: 1000 + i, code_module: i % 2 ? 'BBB' : 'AAA', code_presentation: '2026J', day_of_course: 60,
    risk_level: 'HIGH', risk_probability: .85, recommended_action: 'Contact student immediately', created_at: '2026-09-27',
  })) } });
  adminService.getClocks.mockResolvedValue({ data: { clocks: [{ id: 1, code_module: 'AAA', code_presentation: '2026J', current_day: 60, max_day: 200 }] } });
  adminService.tickAllClocks.mockResolvedValue({ data: { updatedClocks: 1, predictions: { total_students: 32 } } });
  adminService.resetAllClocks.mockResolvedValue({ data: { updatedClocks: 1, predictions: { total_students: 32 } } });
  adminService.runDemoPredictions.mockResolvedValue({ data: { total_students: 32 } });
});
it('paginates loaded results and resets the page when the student or course filter changes', async () => {
  render(<AtRiskStudentsPage />);
  await screen.findByText('1000');
  expect(screen.getAllByRole('row')).toHaveLength(16);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.queryByText('1000')).not.toBeInTheDocument();
  expect(screen.getByText('1015')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search student ID'), { target: { value: '1031' } });
  expect(screen.getByText('1031')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Search student ID'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Course'), { target: { value: 'AAA' } });
  expect(screen.getByText('1000')).toBeInTheDocument();
  expect(screen.queryByText('1001')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('Risk level'), { target: { value: 'MEDIUM' } });
  await waitFor(() => expect(adminService.getAtRiskStudents).toHaveBeenLastCalledWith({ risk_level: 'MEDIUM', limit: 100 }));
});
it('keeps clock actions separate and preserves automatic recomputation through the existing command', async () => {
  render(<AcademicClockPage />);
  await screen.findByText('AAA / 2026J');
  fireEvent.click(screen.getByRole('button', { name: 'Advance 10 days' }));
  await waitFor(() => expect(adminService.tickAllClocks).toHaveBeenCalledWith(10));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Set all clocks' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Set academic day'), { target: { value: '90' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set all clocks' }));
  await waitFor(() => expect(adminService.resetAllClocks).toHaveBeenCalledWith(90));
  expect(adminService.runDemoPredictions).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Update Predictions' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Update Predictions' }));
  await waitFor(() => expect(adminService.runDemoPredictions).toHaveBeenCalledWith(150));
});
it('normalizes risk casing and keeps unknown states neutral', () => {
  const { rerender } = render(<StatusBadge status="HIGH" />);
  expect(screen.getByText('High')).toHaveClass('status-danger');
  rerender(<StatusBadge status="Medium" />);
  expect(screen.getByText('Medium')).toHaveClass('status-warning');
  rerender(<StatusBadge status="unknown" />);
  expect(screen.getByText('Unknown')).toHaveClass('status-neutral');
});
