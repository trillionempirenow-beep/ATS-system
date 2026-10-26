import { BOARD_STAGES, OPTIONAL_STAGES, type Stage } from '../data/types';

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function relative(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const mins = Math.round(diff / 60_000);
  if (Math.abs(mins) < 60) return Math.abs(mins) < 1 ? 'just now' : rtf.format(mins, 'minute');
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return rtf.format(days, 'day');
  return rtf.format(Math.round(days / 30), 'month');
}

export function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
export const fmtNum = (n: number) => n.toLocaleString('en-PH');

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function stageRank(stage: Stage): number {
  return (BOARD_STAGES as readonly Stage[]).indexOf(stage);
}

/** Moving forward past a required stage. Rejecting, moving back or passing an optional stage is never a skip. */
export function skippedStages(from: Stage, to: Stage): Stage[] {
  if (to === 'rejected') return [];
  const f = stageRank(from);
  const t = stageRank(to);
  if (f === -1 || t === -1 || t <= f + 1) return [];
  return BOARD_STAGES.slice(f + 1, t).filter((s) => !OPTIONAL_STAGES.has(s));
}
