import { useEffect, useRef, useState } from 'react';

/** Upright compositor-only motion; no layout work on animation frames. */
export default function useHeroOrbit(heroRef) {
  const [paused, setPaused] = useState(false);
  const manualPause = useRef(false);
  const sync = useRef(null);
  useEffect(() => { manualPause.current = paused; sync.current?.(); }, [paused]);
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero || !window.ResizeObserver || !window.IntersectionObserver || !hero.animate) return;
    const desktop = window.matchMedia('(min-width: 1024px)');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const cards = [...hero.querySelectorAll('.orbit-card')];
    let animations = [];
    let visible = false;
    let hovered = false;
    const playback = () => animations.forEach(a => {
      if (manualPause.current || reduce.matches || !visible || document.hidden || hovered || hero.contains(document.activeElement)) a.pause();
      else a.play();
    });
    sync.current = playback;
    const configure = () => {
      const time = animations[0]?.currentTime || 0;
      animations.forEach(a => a.cancel()); animations = [];
      hero.toggleAttribute('data-orbit-ready', desktop.matches);
      if (!desktop.matches) { cards.forEach(card => card.style.removeProperty('transform')); return; }
      const width = hero.clientWidth, height = hero.clientHeight;
      const rx = width / 2 - cards[0].offsetWidth / 2 - 14;
      const ry = height / 2 - 60;
      cards.forEach((card, index) => {
        const frames = Array.from({ length: 121 }, (_, step) => {
          const angle = -Math.PI * 0.75 + index * Math.PI / 2 + step / 120 * Math.PI * 2;
          return { transform: `translate(-50%, -50%) translate(${(Math.cos(angle) * rx).toFixed(3)}px, ${(Math.sin(angle) * ry).toFixed(3)}px)` };
        });
        card.style.transform = frames[0].transform;
        if (!reduce.matches) {
          const animation = card.animate(frames, { duration: 28000, iterations: Infinity, easing: 'linear' });
          animation.currentTime = time;
          animations.push(animation);
        }
      });
      playback();
    };
    const enter = () => { hovered = true; playback(); };
    const leave = () => { hovered = false; playback(); };
    const focusOut = () => queueMicrotask(playback);
    const resize = new ResizeObserver(configure); resize.observe(hero);
    const intersection = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; playback(); }); intersection.observe(hero);
    hero.addEventListener('mouseenter', enter); hero.addEventListener('mouseleave', leave);
    hero.addEventListener('focusin', playback); hero.addEventListener('focusout', focusOut);
    document.addEventListener('visibilitychange', playback);
    desktop.addEventListener('change', configure); reduce.addEventListener('change', configure);
    configure();
    return () => {
      animations.forEach(a => a.cancel()); resize.disconnect(); intersection.disconnect(); sync.current = null;
      hero.removeEventListener('mouseenter', enter); hero.removeEventListener('mouseleave', leave);
      hero.removeEventListener('focusin', playback); hero.removeEventListener('focusout', focusOut);
      document.removeEventListener('visibilitychange', playback);
      desktop.removeEventListener('change', configure); reduce.removeEventListener('change', configure);
    };
  }, [heroRef]);
  return { paused, togglePause: () => setPaused(value => !value) };
}
