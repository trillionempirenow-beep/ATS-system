import { useLayoutEffect } from 'react';

/**
 * The workspace's modern look is a token layer (styles/workspace.css) that only applies
 * while <html> carries the `ws` class. The careers site, the sign-in screens and the
 * meeting itself never get it, so they keep the look they already have.
 */
export function useWorkspaceLook(active: boolean) {
  useLayoutEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.classList.add('ws');
    return () => root.classList.remove('ws');
  }, [active]);
}
