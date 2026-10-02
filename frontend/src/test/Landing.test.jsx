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

test('scrolling visits each tool, reverses cleanly, and releases with only Oral Exam active', () => {
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
  expect(toolkit).toHaveAttribute('data-toolkit-pinned');
  act(() => nextFrame());
  const stepTravel = parseFloat(toolkit.style.getPropertyValue('--toolkit-travel')) / 5;
  const top = parseFloat(toolkit.style.getPropertyValue('--toolkit-top'));
  const names = ['EduPredict', 'LectureScribe', 'Academic Chatbot', 'Quiz Generator', 'Oral Exam'];
  for (const i of [0, 1, 2, 3, 4, 3, 2, 1, 0, 4]) {
    sectionTop = top - (i + 0.2) * stepTravel;
    fireEvent.scroll(window);
    act(() => nextFrame());
    expect(toolkit).toHaveAttribute('data-toolkit-step', String(i + 1));
    expect(toolkit.querySelectorAll('.tool-card[data-active]')).toHaveLength(1);
    expect(toolkit.querySelector('.tool-card[data-active]')).toHaveAttribute('data-tool-name', names[i]);
    expect(toolkit.querySelectorAll('.tool-card[aria-hidden="false"]')).toHaveLength(1);
    expect(toolkit.querySelectorAll('.toolkit-step a[aria-current="step"]')).toHaveLength(1);
    expect(toolkit.querySelector('.toolkit-current')).toHaveTextContent(names[i]);
    toolkit.querySelectorAll('.tool-card').forEach(card => expect(card.style.transform).not.toMatch(/NaN|undefined/));
  }
  sectionTop = top - stepTravel * 0.78;
  fireEvent.scroll(window);
  act(() => nextFrame());
  expect(toolkit.querySelectorAll('.tool-card[data-visible]')).toHaveLength(2);
  expect(toolkit.querySelectorAll('.tool-card[aria-hidden="false"]')).toHaveLength(1);
  expect(toolkit.querySelector('.tool-card[data-active]').style.getPropertyValue('--card-face')).toBe('1');
  toolkit.querySelectorAll('.tool-card:not([data-active])').forEach(card => expect(card.inert).toBe(true));

  sectionTop = top - stepTravel * 6;
  fireEvent.scroll(window);
  act(() => nextFrame());
  expect(toolkit).toHaveAttribute('data-toolkit-step', '5');
  expect(toolkit.querySelectorAll('.tool-card[data-visible]')).toHaveLength(1);
  expect(toolkit.querySelector('.tool-card[data-active]')).toHaveAttribute('data-tool-name', 'Oral Exam');
});

test('reduced motion changes tools without transforms and the index can seek Oral Exam', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  let nextFrame;
  vi.stubGlobal('requestAnimationFrame', callback => { nextFrame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  let sectionTop = 0;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return { top: this.id === 'tools' ? sectionTop : 0, height: 200 };
  });
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(({ top }) => { sectionTop = -top; });
  showLanding();
  act(() => nextFrame());
  const toolkit = screen.getByRole('region', { name: /^Make room for/ });
  expect(toolkit).toHaveAttribute('data-toolkit-step', '1');
  fireEvent.click(screen.getByRole('link', { name: '05 Oral Exam' }));
  expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'instant' }));
  fireEvent.scroll(window);
  act(() => nextFrame());
  expect(toolkit).toHaveAttribute('data-toolkit-step', '5');
  expect(screen.getByRole('link', { name: 'Explore Oral Exam' })).toHaveAttribute('href', '/login');
  expect(toolkit.querySelectorAll('.tool-card[data-visible]')).toHaveLength(1);
  toolkit.querySelectorAll('.tool-card').forEach(card => expect(card.style.transform).toBe('none'));
});

test('short windows keep one full card accessible through the tool index without pinning', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  let nextFrame;
  vi.stubGlobal('requestAnimationFrame', callback => { nextFrame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  showLanding();
  act(() => nextFrame());
  const toolkit = screen.getByRole('region', { name: /^Make room for/ });
  expect(toolkit).not.toHaveAttribute('data-toolkit-pinned');
  fireEvent.click(screen.getByRole('link', { name: '03 Academic Chatbot' }));
  expect(toolkit).toHaveAttribute('data-toolkit-step', '3');
  expect(screen.getByRole('link', { name: 'Explore Academic Chatbot' })).toBeVisible();
  expect(toolkit.querySelectorAll('.tool-card[aria-hidden="false"]')).toHaveLength(1);
});
