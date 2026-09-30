import type { Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import type { CalendarInvite } from './calendar.js';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  calendar?: CalendarInvite;
}

const ICS_TYPE = (c: CalendarInvite) => `text/calendar; charset=utf-8; method=${c.method}`;

/** "Acme People <no-reply@x>" -> "Acme People" (the name recipients see). */
const senderName = () => /^\s*"?([^"<]*?)"?\s*</.exec(env.EMAIL_FROM)?.[1]?.trim() || '';

export type ProviderResult = { ok: true; id?: string } | { ok: false; error: string };

export interface EmailProvider {
  readonly name: string;
  readonly delivers: boolean;
  send(email: OutgoingEmail): Promise<ProviderResult>;
}

const resend: EmailProvider = {
  name: 'resend',
  delivers: true,
  async send(email) {
    if (!env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY is not set.' };
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': email.idempotencyKey.slice(0, 256),
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
          ...(env.EMAIL_REPLY_TO ? { reply_to: env.EMAIL_REPLY_TO } : {}),
          ...(email.calendar ? { attachments: [{ filename: email.calendar.filename, content: Buffer.from(email.calendar.ics).toString('base64'), content_type: ICS_TYPE(email.calendar) }] } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const payload = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) return { ok: false, error: `Resend HTTP ${res.status}: ${payload.message ?? 'request failed'}` };
      return { ok: true, id: payload.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
    }
  },
};

let transporter: Transporter | null = null;
const smtp: EmailProvider = {
  name: 'smtp',
  delivers: true,
  async send(email) {
    if (!env.SMTP_HOST) return { ok: false, error: 'SMTP_HOST is not set.' };
    const { default: nodemailer } = await import('nodemailer');
    // Google shows app passwords as "abcd efgh ijkl mnop"; its SMTP server wants them without the spaces.
    const gmail = /(^|\.)(gmail|googlemail)\.com$/i.test(env.SMTP_HOST);
    const pass = gmail ? (env.SMTP_PASSWORD ?? '').replace(/\s+/g, '') : (env.SMTP_PASSWORD ?? '');
    transporter ??= nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER.trim(), pass } : undefined,
    });
    try {
      const info = await transporter.sendMail({
        from: env.EMAIL_FROM,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        replyTo: env.EMAIL_REPLY_TO,
        headers: { 'X-Entity-Ref-ID': email.idempotencyKey },
        // Sent as a calendar alternative part, which Gmail and Outlook show as an invitation.
        ...(email.calendar ? { icalEvent: { method: email.calendar.method, filename: email.calendar.filename, content: email.calendar.ics } } : {}),
      });
      return { ok: true, id: info.messageId };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'SMTP error' };
    }
  },
};

/**
 * The "ATS - Send email via Gmail" n8n workflow: POST the message (and the
 * calendar invite as a base64 attachment) with the shared secret; the workflow
 * sends it from the Gmail account connected in n8n and answers { ok, id }.
 */
const n8n: EmailProvider = {
  name: 'n8n',
  delivers: true,
  async send(email) {
    if (!env.EMAIL_N8N_WEBHOOK_URL) return { ok: false, error: 'EMAIL_N8N_WEBHOOK_URL is not set.' };
    try {
      const res = await fetch(env.EMAIL_N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(env.EMAIL_N8N_SECRET ? { 'X-ATS-Secret': env.EMAIL_N8N_SECRET } : {}) },
        body: JSON.stringify({
          to: email.to,
          subject: email.subject,
          html: email.html,
          text: email.text,
          senderName: senderName(),
          replyTo: env.EMAIL_REPLY_TO ?? '',
          idempotencyKey: email.idempotencyKey,
          attachments: email.calendar
            ? [{ filename: email.calendar.filename, mimeType: ICS_TYPE(email.calendar), base64: Buffer.from(email.calendar.ics).toString('base64') }]
            : [],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const raw = await res.text();
      if (!res.ok) return { ok: false, error: `n8n HTTP ${res.status}: ${raw.slice(0, 300) || res.statusText}` };
      const payload = (() => { try { return JSON.parse(raw) as { id?: string }; } catch { return {}; } })();
      return { ok: true, id: payload.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
    }
  },
};

/** Development: prints the message instead of sending it. */
const log: EmailProvider = {
  name: 'log',
  delivers: false,
  async send(email) {
    console.log(`[email:log] to=${email.to} subject="${email.subject}"${email.calendar ? ` +calendar(${email.calendar.method})` : ''}\n${email.text}\n`);
    return { ok: true };
  },
};

export function activeProvider(): EmailProvider | null {
  switch (env.EMAIL_PROVIDER) {
    case 'resend': return resend;
    case 'smtp': return smtp;
    case 'n8n': return n8n;
    case 'log': return log;
    default: return null;
  }
}
