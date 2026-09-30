import { env } from '../config/env.js';

/**
 * Calendar invites for interview emails: an iCalendar (.ics) file that Gmail,
 * Outlook and Apple Mail show as an invitation with "Add to calendar", and a
 * Google Calendar link for a one-click add. The UID is stable per interview,
 * so a reschedule updates the same calendar entry and a cancellation removes it.
 */
export interface CalendarEvent {
  /** Stable per interview, e.g. "interview-42". */
  uid: string;
  start: Date;
  end: Date | null;
  title: string;
  description: string;
  /** A place, or the meeting link. */
  location: string | null;
  url: string | null;
  attendee: { name: string; email: string };
}

export interface CalendarInvite {
  method: 'REQUEST' | 'CANCEL';
  filename: string;
  ics: string;
}

const DEFAULT_MINUTES = 60;
const endOf = (e: CalendarEvent) => e.end && e.end > e.start ? e.end : new Date(e.start.getTime() + DEFAULT_MINUTES * 60_000);
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const text = (v: string) => v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Parameter values (CN=...) are quoted, not escaped, when they hold , ; or : (RFC 5545 §3.2). */
const param = (v: string) => { const clean = v.replace(/["\r\n]/g, ''); return /[,;:]/.test(clean) ? `"${clean}"` : clean; };

/** Lines longer than 75 octets continue on the next line after a space (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (start === 0 ? 75 : 74), bytes.length);
    // Never split inside a multi-byte character.
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
  }
  return parts.join('\r\n ');
}

/** The sender address from EMAIL_FROM ("Name <address>" or a bare address). */
function organizer(): { name: string; email: string } {
  const from = env.EMAIL_FROM;
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1]!.trim(), email: m[2]!.trim() } : { name: '', email: from.trim() };
}

export function calendarInvite(e: CalendarEvent, method: CalendarInvite['method']): CalendarInvite {
  const host = new URL(env.APP_URL).hostname;
  const org = organizer();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Acme People//ATS//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${e.uid}@${host}`,
    // Seconds since the epoch only ever grow, so every update supersedes the one before.
    `SEQUENCE:${Math.floor(Date.now() / 1000)}`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(e.start)}`,
    `DTEND:${utc(endOf(e))}`,
    `SUMMARY:${text(e.title)}`,
    `DESCRIPTION:${text(e.description)}`,
    ...(e.location ? [`LOCATION:${text(e.location)}`] : []),
    ...(e.url ? [`URL:${e.url}`] : []),
    `ORGANIZER;CN=${param(org.name || 'Recruiting')}:mailto:${org.email}`,
    `ATTENDEE;CN=${param(e.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${e.attendee.email}`,
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    ...(method === 'REQUEST'
      ? ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(e.title)}`, 'TRIGGER:-PT30M', 'END:VALARM']
      : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return { method, filename: method === 'CANCEL' ? 'cancelled.ics' : 'invite.ics', ics: `${lines.map(fold).join('\r\n')}\r\n` };
}

/** "Add to Google Calendar" link: opens a pre-filled event, no account connection needed. */
export function googleCalendarLink(e: CalendarEvent): string {
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${utc(e.start)}/${utc(endOf(e))}`,
    details: e.description,
    ...(e.location ? { location: e.location } : {}),
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
