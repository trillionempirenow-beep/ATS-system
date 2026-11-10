/** True when the visitor's system asks for less motion, or they turned it off in Settings (data-motion on <html>). */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce';
}

/** Scroll to the top: smoothly, unless motion is reduced. */
export function scrollToTop(): void {
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}
