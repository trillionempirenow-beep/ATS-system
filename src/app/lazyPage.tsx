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

/** Code-split each page; named exports are wrapped for React.lazy. */
export function page<T extends Record<string, ComponentType>>(load: () => Promise<T>, name: keyof T): ReactNode {
  const Component = lazy(async () => ({ default: (await loadOrReload(load))[name] as ComponentType }));
  return <Suspense fallback={<PageSpinner />}><Component /></Suspense>;
}