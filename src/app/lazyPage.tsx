import { Suspense, lazy, type ComponentType, type ReactNode } from 'react';
import { PageSpinner } from '@/components/ui/Feedback';

const RELOAD_KEY = 'acme:reloaded-for-update';

/** After a new deploy the old page files are gone: reload once to pick up the new ones. */
async function loadOrReload<T>(load: () => Promise<T>): Promise<T> {
  try {
    const mod = await load();
    try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* storage unavailable */ }
    return mod;
  } catch (e) {
    let reloaded = false;
    try { reloaded = sessionStorage.getItem(RELOAD_KEY) === '1'; sessionStorage.setItem(RELOAD_KEY, '1'); } catch { /* storage unavailable */ }
    if (!reloaded) {
      window.location.reload();
      return new Promise<T>(() => undefined);
    }
    throw e;
  }
}

/** Every page's loader, so the staff app can fetch them ahead of the first click (prefetchPages). */
const loaders: Array<() => Promise<unknown>> = [];

/** Code-split each page; named exports are wrapped for React.lazy. */
export function page<T extends Record<string, ComponentType>>(load: () => Promise<T>, name: keyof T): ReactNode {
  loaders.push(load);
  const Component = lazy(async () => ({ default: (await loadOrReload(load))[name] as ComponentType }));
  return <Suspense fallback={<PageSpinner />}><Component /></Suspense>;
}

let prefetched = false;

/**
 * Download every page's code in the background, a few at a time, once the browser is idle.
 * The browser keeps each module, so a later click renders without waiting for its file.
 * Skipped when the visitor asked to save data. Failures are ignored: the click loads it as before.
 */
export function prefetchPages(): void {
  if (prefetched || typeof window === 'undefined') return;
  prefetched = true;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  const queue = [...loaders];
  const idle = (cb: () => void) => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(cb, { timeout: 3000 });
    else setTimeout(cb, 300); // Safari has no requestIdleCallback
  };
  const next = () => {
    const batch = queue.splice(0, 4);
    if (batch.length === 0) return;
    void Promise.allSettled(batch.map((load) => load())).then(() => idle(next));
  };
  idle(next);
}