import { useEffect } from 'react';

const TRAVEL_PER_TOOL = 210;
const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

/** A single physical deck unfolds into the same cards' normal document layout. */
export default function useLandingMotion(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !window.ResizeObserver) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const desktop = window.matchMedia('(min-width: 1024px) and (min-height: 680px)');
    const section = root.querySelector('#tools');
    const stage = section.querySelector('.toolkit-stage');
    const grid = stage.querySelector('.tool-grid');
    const cards = [...grid.querySelectorAll('.tool-card')];
    const steps = [...stage.querySelectorAll('.toolkit-step')];
    const caption = stage.querySelector('.toolkit-current');
    const names = cards.map(card => card.dataset.toolName);
    const travel = TRAVEL_PER_TOOL * cards.length;
    const last = cards.length - 1;
    let frame = 0, pinned = false, keyboard = false, top = 96;
    let geometry = [];

    const deck = (index, active) => {
      const rank = (index - active + cards.length) % cards.length;
      const g = geometry[index];
      const offsets = [[0, 0, 0, 1.35], [48, 24, 4, 1.15], [-32, -20, -5, 1.1], [12, -42, 2, 1.05], [-16, -58, -2, 1.02]];
      const [x, y, angle, scale] = offsets[rank];
      return { x: g.x + x, y: g.y + y, angle, scale, face: Number(rank === 0) };
    };
    const update = () => {
      frame = 0;
      // Group layout reads before writing transform/opacity values.
      const rect = section.getBoundingClientRect();
      const cardRects = !pinned ? cards.map(card => card.getBoundingClientRect()) : [];
      const p = clamp((top - rect.top - 24) / travel);
      const phase = Math.min(last, p * cards.length);
      const from = Math.floor(phase), to = Math.min(last, from + 1);
      const transition = ease(phase - from);
      const assembly = ease((p - last / cards.length) * cards.length);
      const complete = reduce.matches || keyboard || (pinned && p >= 0.999);
      const active = pinned ? Math.min(last, Math.round(phase)) : cardRects.reduce((best, r, i) => Math.abs(r.top + r.height / 2 - innerHeight / 2) < Math.abs(cardRects[best].top + cardRects[best].height / 2 - innerHeight / 2) ? i : best, 0);
      section.toggleAttribute('data-keyboard', keyboard);
      cards.forEach((card, i) => {
        let emphasis = complete ? 1 : Number(i === active);
        if (pinned && !complete) {
          const a = deck(i, from), b = deck(i, to);
          const face = mix(mix(a.face, b.face, transition), 1, assembly);
          const x = mix(a.x, b.x, transition) * (1 - assembly);
          const y = mix(a.y, b.y, transition) * (1 - assembly);
          const scale = mix(mix(a.scale, b.scale, transition), 1, assembly);
          const angle = mix(a.angle, b.angle, transition) * (1 - assembly);
          card.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${angle.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
          card.style.zIndex = String(10 + Math.round(face * 10) + Number(i === active));
          // Keep the front face fully readable throughout a handoff; only concealed faces fade.
          card.style.setProperty('--card-face', clamp(face * 3).toFixed(4));
          emphasis = face;
        } else {
          card.style.removeProperty('transform');
          card.style.removeProperty('z-index');
          card.style.removeProperty('--card-face');
        }
        card.style.setProperty('--card-emphasis', emphasis.toFixed(4));
        card.toggleAttribute('data-active', i === active && !complete);
        steps[i].toggleAttribute('data-active', complete || i === active);
        if (!complete && i === active) steps[i].setAttribute('aria-current', 'step');
        else steps[i].removeAttribute('aria-current');
      });
      section.dataset.toolkitStep = complete ? 'complete' : String(active + 1);
      caption.textContent = complete ? 'Your complete toolkit.' : `0${active + 1} / ${names[active]}`;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const configure = () => {
      top = root.querySelector('.landing-nav').offsetHeight + 16;
      pinned = !reduce.matches && desktop.matches && stage.offsetHeight <= innerHeight - top - 28;
      geometry = cards.map(card => ({ x: (grid.clientWidth - card.offsetWidth) / 2 - card.offsetLeft, y: (grid.clientHeight - card.offsetHeight) / 2 - card.offsetTop }));
      section.toggleAttribute('data-toolkit-story', pinned);
      section.style.setProperty('--toolkit-height', `${stage.offsetHeight}px`);
      section.style.setProperty('--toolkit-travel', `${travel}px`);
      section.style.setProperty('--toolkit-top', `${top}px`);
      schedule();
    };
    // Keyboard readers get the complete, stationary grid as soon as a link takes focus.
    const focusIn = event => { if (event.target.matches(':focus-visible')) { keyboard = true; update(); } };
    const focusOut = () => queueMicrotask(() => { if (!stage.contains(document.activeElement)) { keyboard = false; schedule(); } });
    const observer = new ResizeObserver(configure);
    observer.observe(stage);
    configure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', configure);
    stage.addEventListener('focusin', focusIn); stage.addEventListener('focusout', focusOut);
    reduce.addEventListener('change', configure); desktop.addEventListener('change', configure);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule); window.removeEventListener('resize', configure);
      stage.removeEventListener('focusin', focusIn); stage.removeEventListener('focusout', focusOut);
      reduce.removeEventListener('change', configure); desktop.removeEventListener('change', configure);
    };
  }, [rootRef]);
}
