import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import DashboardHome from '../pages/DashboardHome';
import { dashboardService } from '../services/api';
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { username: 'Advisor', role: 'advisor' } }) }));
vi.mock('../services/api', () => ({ dashboardService: {
  getStats: vi.fn(), getRecentPredictions: vi.fn(), getRiskDistribution: vi.fn(), getCourseStats: vi.fn(),
} }));
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback([{ contentRect: { width: 800, height: 180 } }]); }
    disconnect() {}
  });
  dashboardService.getStats.mockResolvedValue({ data: { totalStudents: 42, totalEnrollments: 12, recentPredictions: 2, atRiskStudents: 1 } });
  dashboardService.getRecentPredictions.mockResolvedValue({ data: [{ id: 1, student_name: 'Zero Risk Student', risk_probability: 0, risk_level: 'Low', created_at: '2026-09-26' }] });
  dashboardService.getRiskDistribution.mockResolvedValue({ data: [{ risk_level: 'Low', count: 2 }] });
  dashboardService.getCourseStats.mockResolvedValue({ data: [{ code_module: 'DEMO', enrollments: 12, avg_risk: null }] });
});
it('renders real charts and displays a zero probability as 0.0%', async () => {
  const { container } = render(<DashboardHome />);
  await screen.findByText('Zero Risk Student');
  expect(screen.getByText('0.0%')).toBeInTheDocument();
  expect(within(screen.getByRole('list', { name: 'Risk distribution legend' })).getAllByRole('listitem')).toHaveLength(3);
  await waitFor(() => expect(container.querySelectorAll('.recharts-surface').length).toBe(2));
});
it('keeps successful sections visible and can recover a failed request', async () => {
  dashboardService.getRiskDistribution.mockRejectedValueOnce(new Error('temporary failure'));
  render(<DashboardHome />);
  await screen.findByRole('alert');
  expect(screen.getByText('42')).toBeInTheDocument();
  expect(screen.getByText('Zero Risk Student')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Try again'));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});
