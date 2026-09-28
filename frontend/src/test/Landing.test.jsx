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
  const hero = screen.getByLabelText('Four learning tools connected through EduFusion');
  expect(hero.querySelector('.art-core')).toBeInTheDocument();
  expect(hero.querySelectorAll('.orbit-card')).toHaveLength(4);
  expect(hero.querySelector('.art-orbit')).toBeNull();
  expect(hero.querySelector('.hero-art-heading')).toBeNull();
  expect(screen.getByRole('heading', { name: 'See it all come together.' })).toBeVisible();
  const links = screen.getByLabelText('Explore the connected tools').querySelectorAll('a');
  expect(links).toHaveLength(4);
  links.forEach(link => expect(link).toHaveAttribute('href', '/login'));
  const toolkit = screen.getByRole('region', { name: /^Make room for/ });
  expect(toolkit.querySelectorAll('.tool-card')).toHaveLength(4);
  toolkit.querySelectorAll('.tool-link').forEach(link => expect(link).toHaveAttribute('href', '/login'));
  expect(document.querySelector('[data-toolkit-story]')).toBeNull();
});

test('the concept film autoplays and repeats both existing clips without captions', () => {
  showLanding();
  const film = () => screen.getByLabelText('EduFusion concept film');
  expect(film()).toHaveAttribute('src', '/edufusion-preview-1.mp4');
  expect(film()).toHaveAttribute('autoplay');
  expect(film().muted).toBe(true);
  expect(film()).toHaveAttribute('playsinline');
  expect(film()).toHaveAttribute('controls');
  expect(document.querySelector('.film-caption')).toBeNull();
  expect(document.querySelector('.story-resolution')).toBeNull();
  fireEvent.ended(film());
  expect(film()).toHaveAttribute('src', '/edufusion-preview-2.mp4');
  fireEvent.ended(film());
  expect(film()).toHaveAttribute('src', '/edufusion-preview-1.mp4');
});

test('media failure returns to the poster and leaves the real tools reachable', () => {
  showLanding();
  fireEvent.error(screen.getByLabelText('EduFusion concept film'));
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
