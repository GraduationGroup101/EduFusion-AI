import { useEffect } from 'react';

const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

/** Native scroll drives one reading surface. No wheel interception or timed slides. */
export default function useLandingMotion(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !window.ResizeObserver) return;
    const section = root.querySelector('#tools');
    const stage = section.querySelector('.toolkit-stage');
    const context = stage.querySelector('.toolkit-context');
    const grid = stage.querySelector('.tool-grid');
    const cards = [...grid.querySelectorAll('.tool-card')];
    const steps = [...stage.querySelectorAll('.toolkit-step')];
    const caption = stage.querySelector('.toolkit-current');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, pinned = false, top = 96, padding = 0, stepTravel = 320;
    let selected = 0, focused = null;
    const last = cards.length - 1;
    section.setAttribute('data-toolkit-enhanced', '');

    const update = () => {
      frame = 0;
      const distance = top - section.getBoundingClientRect().top - padding;
      const phase = pinned ? Math.max(0, Math.min(last + 1, distance / stepTravel)) : selected;
      const from = focused ?? Math.min(last, Math.floor(phase));
      const to = Math.min(last, from + 1);
      const transition = focused === null && pinned && from !== last ? ease((phase - from - 0.56) / 0.44) : 0;
      const active = transition >= 0.5 ? to : from;
      selected = active;

      cards.forEach((card, index) => {
        const outgoing = index === from;
        const incoming = index === to && transition > 0;
        const visible = reduce.matches ? index === active : outgoing || incoming;
        // Keep the foreground opaque: two translucent text faces would ghost together.
        const opacity = index === active ? 1 : outgoing ? (1 - transition) * 0.4 : incoming ? transition * 0.4 : 0;
        const y = outgoing ? -20 * transition : 28 * (1 - transition);
        const x = outgoing ? -12 * transition : 16 * (1 - transition);
        const scale = outgoing ? 1 - 0.025 * transition : 0.965 + 0.035 * transition;
        card.style.opacity = String(reduce.matches ? Number(index === active) : opacity);
        card.style.transform = reduce.matches ? 'none' : `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
        card.style.zIndex = String(index === active ? 3 : 2);
        card.style.setProperty('--card-emphasis', '0');
        card.style.setProperty('--card-face', index === active ? '1' : '0');
        card.toggleAttribute('data-visible', visible);
        card.toggleAttribute('data-active', index === active);
        card.inert = index !== active;
        card.setAttribute('aria-hidden', String(index !== active));
        steps[index].toggleAttribute('data-active', index === active);
        const link = steps[index].querySelector('a');
        if (index === active) link.setAttribute('aria-current', 'step');
        else link.removeAttribute('aria-current');
      });
      section.dataset.toolkitStep = String(active + 1);
      caption.textContent = cards[active].dataset.toolName;
      // Describe painted state, including intentional reading holds.
      stage.dataset.scVerifyState = `${active}:${transition.toFixed(2)}`;
      stage.toggleAttribute('data-sc-verify-hold', transition === 0 || reduce.matches);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const configure = () => {
      top = root.querySelector('.landing-nav').offsetHeight + 12;
      section.style.setProperty('--toolkit-top', `${top}px`);
      padding = parseFloat(getComputedStyle(section).paddingTop) || 0;
      const stacked = getComputedStyle(stage).gridTemplateColumns.split(' ').length === 1;
      const gap = parseFloat(getComputedStyle(stage).rowGap) || 0;
      const contentHeight = stacked ? context.offsetHeight + grid.offsetHeight + gap : Math.max(context.offsetHeight, grid.offsetHeight);
      const available = parseFloat(getComputedStyle(stage).minHeight) || innerHeight - top - 16;
      pinned = contentHeight <= available;
      stepTravel = Math.max(240, Math.min(420, available * 0.55));
      section.style.setProperty('--toolkit-travel', `${stepTravel * cards.length}px`);
      section.toggleAttribute('data-toolkit-pinned', pinned);
      schedule();
    };
    const choose = event => {
      const link = event.target.closest('[data-tool-index]');
      if (!link || !context.contains(link) || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      selected = Number(link.dataset.toolIndex);
      focused = null;
      if (pinned) {
        const target = scrollY + section.getBoundingClientRect().top + padding - top + selected * stepTravel;
        window.scrollTo({ top: Math.max(0, target), behavior: reduce.matches ? 'instant' : 'smooth' });
      } else update();
    };
    const focusIn = event => {
      const card = event.target.closest('.tool-card');
      if (card && event.target.matches(':focus-visible')) { focused = cards.indexOf(card); update(); }
    };
    const focusOut = () => queueMicrotask(() => {
      if (!grid.contains(document.activeElement)) { focused = null; schedule(); }
    });
    const observer = new ResizeObserver(configure);
    observer.observe(context); observer.observe(grid);
    configure();
    context.addEventListener('click', choose);
    grid.addEventListener('focusin', focusIn); grid.addEventListener('focusout', focusOut);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', configure);
    reduce.addEventListener('change', configure);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      context.removeEventListener('click', choose);
      grid.removeEventListener('focusin', focusIn); grid.removeEventListener('focusout', focusOut);
      window.removeEventListener('scroll', schedule); window.removeEventListener('resize', configure);
      reduce.removeEventListener('change', configure);
      section.removeAttribute('data-toolkit-enhanced'); section.removeAttribute('data-toolkit-pinned');
      cards.forEach(card => {
        card.inert = false; card.removeAttribute('aria-hidden'); card.removeAttribute('data-visible');
        card.style.removeProperty('opacity'); card.style.removeProperty('transform'); card.style.removeProperty('z-index');
        card.style.removeProperty('--card-face'); card.style.removeProperty('--card-emphasis');
      });
    };
  }, [rootRef]);
}
