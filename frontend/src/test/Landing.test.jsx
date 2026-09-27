import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Landing from '../pages/Landing';

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: false, user: null }) }));
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => vi.unstubAllGlobals());
const showLanding = () => render(<MemoryRouter><Landing /></MemoryRouter>);

test('the complete story and tool links remain available without browser animation APIs', () => {
  showLanding();
  expect(screen.getByRole('heading', { name: 'See it all come together.' })).toBeVisible();
  const links = screen.getByLabelText('Explore the connected tools').querySelectorAll('a');
  expect(links).toHaveLength(4);
  links.forEach(link => expect(link).toHaveAttribute('href', '/login'));
  expect(document.querySelector('[data-scroll-story]')).toBeNull();
});

test('film media is not requested until the visitor chooses to play', () => {
  showLanding();
  expect(document.querySelector('video')).toBeNull();
  expect(screen.getByAltText('Concept preview of the EduFusion learning workspace')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Play film' }));
  expect(screen.getByLabelText('EduFusion concept film')).toHaveAttribute('src', '/edufusion-preview-1.mp4');
  expect(screen.getByLabelText('EduFusion concept film')).toHaveAttribute('controls');
});

test('media failure returns to the poster and leaves the real tools reachable', () => {
  showLanding();
  fireEvent.click(screen.getByRole('button', { name: 'Play film' }));
  fireEvent.error(screen.getByLabelText('EduFusion concept film'));
  expect(screen.getByText('Film unavailable. Explore the tools above.')).toBeVisible();
  expect(screen.getByAltText('Concept preview of the EduFusion learning workspace')).toBeVisible();
  expect(screen.getByLabelText('Explore the connected tools').querySelectorAll('a')).toHaveLength(4);
});

test('Escape dismisses mobile navigation and returns focus to its trigger', () => {
  showLanding();
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  expect(screen.getByRole('navigation', { name: 'Mobile navigation' })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('navigation', { name: 'Mobile navigation' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus();
});
