import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it } from 'vitest';
import api from '../services/api';
import { AuthProvider } from '../context/AuthContext';
import ChatbotPage from '../pages/ChatbotPage';
import Auth from '../pages/Auth';
import ErrorBoundary from '../components/ui/ErrorBoundary';

let respond;
beforeEach(() => {
  window.matchMedia ||= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  Element.prototype.scrollTo ||= function scrollTo() {};
  respond = async () => ({});
  api.defaults.adapter = async (config) => {
    const result = await respond(config);
    if (result?.status >= 400) {
      const error = new Error('Request failed');
      error.response = { status: result.status, data: result.data, config };
      throw error;
    }
    return { data: result, status: 200, statusText: 'OK', headers: {}, config };
  };
});

it('keeps a question sent while the earlier conversation is still loading', async () => {
  let releaseHistory;
  respond = (config) => {
    if (config.url.startsWith('/chatbot/history/')) return new Promise((resolve) => { releaseHistory = () => resolve({ messages: [] }); });
    if (config.url === '/chatbot/chat') return { answer: '## Registration\n- Opens on Sunday\n- Bring your ID' };
    return { status: 'ok' };
  };
  render(<ChatbotPage />);
  const box = screen.getByLabelText('Your question');
  fireEvent.change(box, { target: { value: 'متى يبدأ التسجيل؟' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  await screen.findByText('Opens on Sunday');
  releaseHistory();
  await waitFor(() => expect(screen.queryByText('Loading your conversation…')).toBeNull());
  // The question survives the late history response, and the answer is rendered, not raw Markdown.
  expect(screen.getByText('متى يبدأ التسجيل؟')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Registration' })).toBeTruthy();
  expect(screen.queryByText(/^- Opens/)).toBeNull();
});

it('explains a wrong PIN inside the sign-in form and clears it when the student edits', async () => {
  respond = (config) => (config.url === '/auth/login' ? { status: 401, data: { error: 'Invalid credentials' } } : {});
  render(<MemoryRouter initialEntries={['/login']}><AuthProvider><Auth mode="login" /></AuthProvider></MemoryRouter>);
  fireEvent.change(screen.getByPlaceholderText('e.g. 120210627'), { target: { value: '20240001' } });
  fireEvent.change(screen.getByPlaceholderText('Enter your PIN or password'), { target: { value: 'wrong' } });
  fireEvent.click(within(document.querySelector('form')).getByRole('button', { name: /Sign in/ }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/student ID or PIN is not correct/);
  fireEvent.change(screen.getByPlaceholderText('Enter your PIN or password'), { target: { value: 'again' } });
  expect(screen.queryByRole('alert')).toBeNull();
});

it('shows a recoverable message instead of a blank page when a page fails to render', () => {
  const Broken = () => { throw new Error('bad payload'); };
  const original = console.error;
  console.error = () => {};
  try {
    render(<ErrorBoundary><Broken /></ErrorBoundary>);
  } finally {
    console.error = original;
  }
  expect(screen.getByRole('alert').textContent).toMatch(/could not be displayed/);
  expect(screen.getByRole('link', { name: 'Back to dashboard' })).toBeTruthy();
});
