import { useEffect } from 'react';

/** The toolkit stays readable in document flow without animation support. */
export default function useLandingMotion(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !window.IntersectionObserver || !window.ResizeObserver) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const desktop = window.matchMedia('(min-width: 1024px) and (min-height: 680px)');
    const section = root.querySelector('#tools');
    const stage = root.querySelector('.toolkit-stage');
    const cards = [...stage.querySelectorAll('.tool-card')];
    const steps = [...stage.querySelectorAll('.toolkit-step')];
    const caption = stage.querySelector('.toolkit-current');
    const names = cards.map(card => card.dataset.toolName);
    let frame = 0;
    let pinned = false;
    const update = () => {
      frame = 0;
      const rect = section.getBoundingClientRect();
      const cardRects = !pinned ? cards.map(card => card.getBoundingClientRect()) : [];
      const p = Math.max(0, Math.min(1, (108 - rect.top - 24) / 640));
      const complete = reduce.matches || (pinned && p >= 0.99);
      const active = pinned ? Math.min(3, Math.round(p * 4)) : cardRects.reduce((best, r, i) => Math.abs(r.top + r.height / 2 - innerHeight / 2) < Math.abs(cardRects[best].top + cardRects[best].height / 2 - innerHeight / 2) ? i : best, 0);
      cards.forEach((card, i) => {
        const emphasis = complete ? 1 : pinned ? Math.max(0, 1 - Math.abs(p * 4 - i), (p - 0.8) / 0.2) : Number(i === active);
        card.style.setProperty('--card-emphasis', Math.min(1, emphasis).toFixed(4));
        card.toggleAttribute('data-active', !reduce.matches && i === active && !complete);
        steps[i].toggleAttribute('data-active', complete || i === active);
        if (!complete && i === active) steps[i].setAttribute('aria-current', 'step');
        else steps[i].removeAttribute('aria-current');
      });
      section.dataset.toolkitStep = complete ? 'complete' : String(active + 1);
      caption.textContent = complete ? 'One learning journey. Four connected tools.' : `0${active + 1} / ${names[active]}`;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const configure = () => {
      pinned = !reduce.matches && desktop.matches && stage.offsetHeight <= innerHeight - 136;
      section.toggleAttribute('data-toolkit-story', pinned);
      section.style.setProperty('--toolkit-height', `${stage.offsetHeight}px`);
      schedule();
    };
    const observer = new ResizeObserver(configure);
    observer.observe(stage);
    configure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', configure);
    reduce.addEventListener('change', configure);
    desktop.addEventListener('change', configure);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', configure);
      reduce.removeEventListener('change', configure);
      desktop.removeEventListener('change', configure);
    };
  }, [rootRef]);
}
