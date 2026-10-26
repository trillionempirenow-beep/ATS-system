import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setTimeFormat } from '@/lib/format';
import { useAuth } from './AuthProvider';

export type Density = 'comfortable' | 'compact';
export type StartPage = 'overview' | 'pipeline' | 'candidates' | 'interviews';
export type TimeFormat = '12h' | '24h';
export type MotionPref = 'auto' | 'reduce';

export interface Preferences {
  density: Density;
  startPage: StartPage;
  timeFormat: TimeFormat;
  motion: MotionPref;
}

export const DEFAULT_PREFERENCES: Preferences = { density: 'comfortable', startPage: 'overview', timeFormat: '12h', motion: 'auto' };

/** Where each start page lives. */
export const START_PAGE_PATHS: Record<StartPage, string> = {
  overview: '/app',
  pipeline: '/app/pipeline',
  candidates: '/app/candidates',
  interviews: '/app/interviews',
};

interface PreferencesApi {
  prefs: Preferences;
  setPref: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  reset: () => void;
  isDefault: boolean;
}

const PreferencesContext = createContext<PreferencesApi | null>(null);
const storageKey = (userId: number) => `acme-prefs-v1:${userId}`;

function read(userId: number | null): Preferences {
  if (userId === null) return DEFAULT_PREFERENCES;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULT_PREFERENCES;
    const p = JSON.parse(raw) as Partial<Preferences>;
    return {
      density: p.density === 'compact' ? 'compact' : 'comfortable',
      startPage: p.startPage && p.startPage in START_PAGE_PATHS ? p.startPage : 'overview',
      timeFormat: p.timeFormat === '24h' ? '24h' : '12h',
      motion: p.motion === 'reduce' ? 'reduce' : 'auto',
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/** Per-person, per-browser preferences. They shape how the workspace looks and where it opens. */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // Read synchronously from storage (not in an effect) so the very first render of the shell already knows them.
  const [version, setVersion] = useState(0);
  const prefs = useMemo(() => {
    void version; // the "storage changed" signal: re-read after every save
    const p = read(userId);
    setTimeFormat(userId === null ? '12h' : p.timeFormat); // idempotent: safe to run during render, so this render's times already use it
    return p;
  }, [userId, version]);

  useEffect(() => {
    const root = document.documentElement;
    if (userId === null) {
      delete root.dataset.density;
      delete root.dataset.motion;
      return;
    }
    root.dataset.density = prefs.density;
    root.dataset.motion = prefs.motion;
  }, [prefs, userId]);

  const persist = useCallback((next: Preferences) => {
    if (userId === null) return;
    try { localStorage.setItem(storageKey(userId), JSON.stringify(next)); } catch { /* private mode: applies for this visit */ }
    setVersion((v) => v + 1);
  }, [userId]);

  const setPref = useCallback(<K extends keyof Preferences>(key: K, value: Preferences[K]) => persist({ ...prefs, [key]: value }), [persist, prefs]);
  const reset = useCallback(() => persist(DEFAULT_PREFERENCES), [persist]);

  const api = useMemo<PreferencesApi>(() => ({
    prefs, setPref, reset,
    isDefault: (Object.keys(DEFAULT_PREFERENCES) as Array<keyof Preferences>).every((k) => prefs[k] === DEFAULT_PREFERENCES[k]),
  }), [prefs, setPref, reset]);

  return <PreferencesContext.Provider value={api}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesApi {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside PreferencesProvider');
  return ctx;
}
