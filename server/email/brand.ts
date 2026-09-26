import { env } from '../config/env.js';
import { getSettings } from '../core/settings.js';
import type { Brand } from './templates/layout.js';
import type { WhenInfo } from './templates/index.js';

export async function brand(): Promise<Brand> {
  const s = await getSettings();
  const logo = s.logo_path.trim();
  return {
    company: s.company_name || 'Acme',
    appUrl: env.APP_URL.replace(/\/$/, ''),
    logoUrl: logo ? (/^https?:\/\//.test(logo) ? logo : `${env.APP_URL.replace(/\/$/, '')}/${logo.replace(/^\//, '')}`) : null,
    supportEmail: env.EMAIL_REPLY_TO ?? null,
  };
}

/** Dates in emails use the company timezone and say which one. */
export function whenInfo(iso: string | Date, timezone = env.APP_TIMEZONE): WhenInfo {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const date = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: timezone }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(d);
  const tzName = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' })
    .formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? timezone;
  return { date, time, timezone: `${tzName}, ${timezone}` };
}

export const appLink = (path: string): string => `${env.APP_URL.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
