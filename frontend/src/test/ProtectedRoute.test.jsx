import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from '../components/auth/ProtectedRoute';
import { useAuth } from '../context/AuthContext';
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
const show = () => render(<MemoryRouter initialEntries={['/admin']}><Routes>
  <Route path="/admin" element={<ProtectedRoute allowedRoles={['admin','advisor']}><p>Admin content</p></ProtectedRoute>} />
  <Route path="/dashboard" element={<p>Dashboard</p>} /><Route path="/login" element={<p>Login</p>} />
</Routes></MemoryRouter>);
describe('ProtectedRoute', () => {
  it('redirects a signed-out visitor to login', () => { useAuth.mockReturnValue({ isAuthenticated:false,loading:false }); show(); expect(screen.getByText('Login')).toBeInTheDocument(); });
  it('prevents students from opening an administration page', () => { useAuth.mockReturnValue({ isAuthenticated:true,loading:false,user:{role:'student'} }); show(); expect(screen.getByText('Dashboard')).toBeInTheDocument(); expect(screen.queryByText('Admin content')).toBeNull(); });
  it('preserves access for administrators and advisors', () => { useAuth.mockReturnValue({ isAuthenticated:true,loading:false,user:{role:'advisor'} }); show(); expect(screen.getByText('Admin content')).toBeInTheDocument(); });
});
