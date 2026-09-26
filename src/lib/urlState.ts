import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export type ParamPatch = Record<string, string | null | undefined>;

/**
 * Search params as page state. set() patches keys (empty values remove them)
 * and replaces the history entry. It keeps one identity for the page's life,
 * unlike setSearchParams, so effects can depend on it without re-running.
 */
export function useUrlParams() {
  const [params, setParams] = useSearchParams();
  const setRef = useRef(setParams);
  setRef.current = setParams;
  const set = useCallback((patch: ParamPatch) => {
    setRef.current((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
      return next;
    }, { replace: true });
  }, []);
  return [params, set] as const;
}

/**
 * A search box bound to one param: typing updates the box at once and the URL
 * after a pause. The URL is only written when the text really changed, so
 * opening a link never resets other params such as the page number.
 */
export function useDebouncedParam(key: string, resetOnChange?: string) {
  const [params, set] = useUrlParams();
  const urlValue = params.get(key) ?? '';
  const [value, setValue] = useState(urlValue);
  useEffect(() => {
    const next = value.trim();
    if (next === urlValue) return undefined;
    const t = window.setTimeout(() => set(resetOnChange ? { [key]: next || null, [resetOnChange]: null } : { [key]: next || null }), 300);
    return () => window.clearTimeout(t);
  }, [value, urlValue, key, resetOnChange, set]);
  return [value, setValue] as const;
}
