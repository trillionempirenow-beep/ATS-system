import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';
interface ThemeApi { theme: Theme; toggle: () => void; set: (t: Theme) => void }

const ThemeContext = createContext<ThemeApi | null>(null);
const KEY = 'acme-theme';

function initial(): Theme {
  const attr = document.documentElement.dataset.theme;
  return attr === 'dark' ? 'dark' : 'light';
}

/** Follows the system on first visit, then remembers the header toggle per browser. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem(KEY); } catch { saved = null; }
      if (!saved) setTheme(mq.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const set = useCallback((t: Theme) => {
    setTheme(t);
    try { localStorage.setItem(KEY, t); } catch { /* private mode: theme still applies for this visit */ }
  }, []);
  const api = useMemo(() => ({ theme, set, toggle: () => set(theme === 'dark' ? 'light' : 'dark') }), [theme, set]);
  return <ThemeContext.Provider value={api}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
