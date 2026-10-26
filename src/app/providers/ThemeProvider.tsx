import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';
interface ThemeApi {
  /** What is on screen right now. */
  theme: Theme;
  /** What the person chose: a fixed theme, or to follow the system. */
  preference: ThemePreference;
  toggle: () => void;
  set: (t: Theme) => void;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeApi | null>(null);
const KEY = 'acme-theme';

function initial(): Theme {
  const attr = document.documentElement.dataset.theme;
  return attr === 'dark' ? 'dark' : 'light';
}

function savedPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Follows the system on first visit, then remembers the header toggle per browser. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const [preference, setPref] = useState<ThemePreference>(savedPreference);
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
    setPref(t);
    try { localStorage.setItem(KEY, t); } catch { /* private mode: theme still applies for this visit */ }
  }, []);
  const setPreference = useCallback((p: ThemePreference) => {
    if (p !== 'system') return set(p);
    setPref('system');
    try { localStorage.removeItem(KEY); } catch { /* private mode */ }
    setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }, [set]);
  const api = useMemo(
    () => ({ theme, preference, set, setPreference, toggle: () => set(theme === 'dark' ? 'light' : 'dark') }),
    [theme, preference, set, setPreference],
  );
  return <ThemeContext.Provider value={api}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
