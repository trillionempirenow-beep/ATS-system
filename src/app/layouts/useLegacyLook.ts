import { useEffect } from 'react';

/** The careers site and sign-in screens keep their original look: see styles/legacy.css. */
export function useLegacyLook() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('legacy');
    return () => root.classList.remove('legacy');
  }, []);
}
