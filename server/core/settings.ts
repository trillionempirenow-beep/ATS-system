import { sql, type Db } from '../db/client.js';

export const SETTING_DEFAULTS = {
  company_name: 'Acme',
  careers_headline: 'Do the best work of your career.',
  default_applicant_limit: '',
  logo_path: '',
  attendance_timezone: 'Asia/Manila',
  attendance_grace_minutes: '10',
  candidate_required_fields: '["full_name","email"]',
  interview_join_window_minutes: '15',
  password_reset_hours: '24',
  meeting_presence_seconds: '35',
  portal_accepting_applications: '1',
  portal_closed_message: '',
  interview_reminder_minutes: '60',
  recording_retention_days: '90',
  ice_servers: '[{"urls":"stun:stun.l.google.com:19302"}]',
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = Record<SettingKey, string>;

let cache: { at: number; values: Settings } | null = null;
const TTL_MS = 5_000;

export async function getSettings(db: Db = sql): Promise<Settings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.values;
  const rows = await db<{ setting_key: string; setting_value: string }[]>`select setting_key, setting_value from settings`;
  const values: Settings = { ...SETTING_DEFAULTS };
  for (const r of rows) {
    if (r.setting_key in values) values[r.setting_key as SettingKey] = r.setting_value;
  }
  cache = { at: Date.now(), values };
  return values;
}

export async function setSettings(db: Db, patch: Partial<Settings>): Promise<void> {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    await db`insert into settings (setting_key, setting_value) values (${key}, ${value})
             on conflict (setting_key) do update set setting_value = excluded.setting_value`;
  }
  cache = null;
}

export const intSetting = (value: string, fallback: number, min = 0): number => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(min, n) : fallback;
};

export async function interviewTiming() {
  const s = await getSettings();
  return {
    joinWindowMinutes: intSetting(s.interview_join_window_minutes, 15),
    presenceSeconds: intSetting(s.meeting_presence_seconds, 35, 10),
  };
}
