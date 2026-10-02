import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Landing from '../pages/Landing';

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: false, user: null }) }));
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const showLanding = () => render(<MemoryRouter><Landing /></MemoryRouter>);

test('the complete story and tool links remain available without browser animation APIs', () => {
  showLanding();
  const hero = screen.getByLabelText('Five learning tools connected through EduFusion');
  expect(hero.querySelector('.art-core')).toBeInTheDocument();
  expect(hero.querySelectorAll('.orbit-card')).toHaveLength(5);
  expect(hero.querySelector('.art-orbit')).toBeNull();
  expect(hero.querySelector('.hero-art-heading')).toBeNull();
  expect(screen.getByRole('heading', { name: 'See it all come together.' })).toBeVisible();
  const links = screen.getByLabelText('Explore the connected tools').querySelectorAll('a');
  expect(links).toHaveLength(5);
  links.forEach(link => expect(link).toHaveAttribute('href', '/login'));
  const toolkit = screen.getByRole('region', { name: /^Make room for/ });
  expect(toolkit.querySelectorAll('.tool-card')).toHaveLength(5);
  expect(hero.querySelector('.orbit-card-4')).toHaveTextContent('Oral Exam');
  expect(toolkit.querySelectorAll('.tool-card')[4]).toHaveTextContent('05 / Oral Exam');
  expect(screen.getByRole('link', { name: 'Explore Oral Exam' })).toHaveAttribute('href', '/login');
  expect(document.querySelector('.platform-strip')).toHaveTextContent('ONE SPACE. FIVE POSSIBILITIES.');
  expect(document.querySelector('.platform-strip')).toHaveTextContent('Oral Exam');
  expect(document.querySelector('.landing-page')).not.toHaveTextContent(/four (connected|education|learning|possibilities)/i);
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

test('the concept film pauses offscreen, resumes in view, and keeps cycling', () => {
  let onIntersection;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback) { onIntersection = callback; }
    observe() {}
    disconnect() {}
  });
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  showLanding();
  const film = () => screen.getByLabelText('EduFusion concept film');
  expect(film()).not.toHaveAttribute('autoplay');
  expect(play).not.toHaveBeenCalled();

  act(() => onIntersection([{ isIntersecting: true }]));
  expect(play).toHaveBeenCalledTimes(1);
  act(() => onIntersection([{ isIntersecting: false }]));
  expect(pause).toHaveBeenCalledTimes(1);
  act(() => onIntersection([{ isIntersecting: true }]));
  expect(play).toHaveBeenCalledTimes(2);

  fireEvent.ended(film());
  expect(film()).toHaveAttribute('src', '/edufusion-preview-2.mp4');
  expect(play).toHaveBeenCalledTimes(2);
  act(() => onIntersection([{ isIntersecting: true }]));
  expect(play).toHaveBeenCalledTimes(3);
  fireEvent.ended(film());
  expect(film()).toHaveAttribute('src', '/edufusion-preview-1.mp4');
});

test('media failure returns to the poster and leaves the real tools reachable', () => {
  showLanding();
  fireEvent.error(screen.getByLabelText('EduFusion concept film'));
  expect(screen.getByAltText('Concept preview of the EduFusion learning workspace')).toBeVisible();
  expect(screen.getByLabelText('Explore the connected tools').querySelectorAll('a')).toHaveLength(5);
});

test('Escape dismisses mobile navigation and returns focus to its trigger', () => {
  showLanding();
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  expect(screen.getByRole('navigation', { name: 'Mobile navigation' })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('navigation', { name: 'Mobile navigation' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus();
});

test('scrolling reaches Oral Exam before unfolding the complete five-tool deck', () => {
  vi.stubGlobal('matchMedia', vi.fn(query => ({ matches: !query.includes('reduced-motion'), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  let nextFrame;
  vi.stubGlobal('requestAnimationFrame', callback => { nextFrame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  let sectionTop = 0;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return { top: this.id === 'tools' ? sectionTop : 0, height: 200 };
  });
  showLanding();
  const toolkit = screen.getByRole('region', { name: /^Make room for/ });
  expect(toolkit).toHaveAttribute('data-toolkit-story');
  act(() => nextFrame());

  // Near the end of the sequence, the fifth tool must have its own spotlight.
  sectionTop = -790;
  fireEvent.scroll(window);
  act(() => nextFrame());
  expect(toolkit).toHaveAttribute('data-toolkit-step', '5');
  expect(toolkit.querySelector('.tool-card[data-active]')).toHaveAttribute('data-tool-name', 'Oral Exam');
  expect(toolkit.querySelector('.toolkit-current')).toHaveTextContent('05 / Oral Exam');
  toolkit.querySelectorAll('.tool-card').forEach(card => expect(card.style.transform).not.toMatch(/NaN|undefined/));

  sectionTop = -1100;
  fireEvent.scroll(window);
  act(() => nextFrame());
  expect(toolkit).toHaveAttribute('data-toolkit-step', 'complete');
  expect(toolkit.querySelector('.toolkit-current')).toHaveTextContent('Your complete toolkit.');
  toolkit.querySelectorAll('.tool-card').forEach(card => expect(card.style.transform).toBe(''));
});

test('reduced motion keeps all five toolkit cards stationary and reachable', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  let nextFrame;
  vi.stubGlobal('requestAnimationFrame', callback => { nextFrame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  showLanding();
  act(() => nextFrame());
  const toolkit = screen.getByRole('region', { name: /^Make room for/ });
  expect(toolkit).not.toHaveAttribute('data-toolkit-story');
  expect(toolkit).toHaveAttribute('data-toolkit-step', 'complete');
  expect(toolkit.querySelectorAll('.tool-link')).toHaveLength(5);
  toolkit.querySelectorAll('.tool-card').forEach(card => expect(card.style.transform).toBe(''));
});
