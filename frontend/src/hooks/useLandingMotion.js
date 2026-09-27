import { useEffect } from 'react';

/** Optional enhancement: markup is visible before this hook runs or if it fails. */
export default function useLandingMotion(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const desktop = window.matchMedia('(min-width: 1024px) and (min-height: 700px)');
    if (!root || !window.IntersectionObserver || !window.ResizeObserver) return;
    const story = root.querySelector('.scroll-story');
    const stage = root.querySelector('.story-stage');
    const hero = root.querySelector('.hero-art');
    let frame = 0;
    let enabled = false;
    const animations = new Set();
    const revealed = new WeakSet();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(({ target, isIntersecting }) => {
        if (!isIntersecting || reduce.matches || revealed.has(target)) return;
        revealed.add(target);
        const animation = target.animate(
          [{ opacity: 0.75, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
          { duration: 420, delay: Number(target.dataset.revealOrder || 0) * 45, easing: 'cubic-bezier(.23,1,.32,1)' },
        );
        animations.add(animation);
        animation.onfinish = () => animations.delete(animation);
      });
    }, { threshold: 0.12 });
    root.querySelectorAll('[data-reveal]').forEach(el => observer.observe(el));
    const update = () => {
      frame = 0;
      if (reduce.matches) return;
      // Read geometry together, then update only compositor-friendly transforms.
      const rect = story.getBoundingClientRect();
      const heroRect = hero.getBoundingClientRect();
      const progress = enabled ? Math.max(0, Math.min(1, (108 - rect.top - 32) / 360)) : 1;
      story.style.setProperty('--story-progress', progress.toFixed(4));
      story.querySelectorAll('.story-tool').forEach((el, index) => {
        const phase = enabled ? Math.max(0, Math.min(1, (progress - index * 0.17) / 0.35)) : 1;
        el.style.setProperty('--tool-progress', phase.toFixed(4));
      });
      hero.style.setProperty('--hero-depth', desktop.matches ? `${Math.max(-8, Math.min(8, -heroRect.top * 0.025))}px` : '0px');
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const configure = () => {
      animations.forEach(animation => animation.cancel());
      animations.clear();
      enabled = !reduce.matches && desktop.matches && stage.offsetHeight < innerHeight - 136;
      story.toggleAttribute('data-scroll-story', enabled);
      story.style.setProperty('--story-height', `${stage.offsetHeight}px`);
      if (reduce.matches) {
        story.style.removeProperty('--story-progress');
        story.querySelectorAll('.story-tool').forEach(el => el.style.removeProperty('--tool-progress'));
        hero.style.removeProperty('--hero-depth');
      } else schedule();
    };
    const resize = new ResizeObserver(configure);
    resize.observe(stage);
    configure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', configure);
    reduce.addEventListener('change', configure);
    desktop.addEventListener('change', configure);
    return () => {
      observer.disconnect(); resize.disconnect();
      cancelAnimationFrame(frame);
      animations.forEach(animation => animation.cancel());
      story.removeAttribute('data-scroll-story');
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', configure);
      reduce.removeEventListener('change', configure);
      desktop.removeEventListener('change', configure);
    };
  }, [rootRef]);
}
