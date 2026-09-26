import { env } from '../config/env.js';

export const iso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : (typeof d === 'string' ? new Date(d) : d).toISOString();

export const isoOrThrow = (d: Date | string): string => (typeof d === 'string' ? new Date(d) : d).toISOString();

export function formatTime(value: Date | string, timezone = env.APP_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(value));
}

/** "Today" as a calendar date in the company timezone (attendance work days). */
export function todayInZone(timezone = env.APP_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export const fullName = (first: string | null | undefined, last: string | null | undefined): string =>
  `${first ?? ''} ${last ?? ''}`.trim();

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

/** Prefix for CSV downloads so Excel opens them as UTF-8. */
export const UTF8_BOM = String.fromCharCode(0xfeff);
