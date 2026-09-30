import type { Transporter } from 'nodemailer';
import { env } from '../config/env.js';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}

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
      });
      return { ok: true, id: info.messageId };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'SMTP error' };
    }
  },
};

/** Development: prints the message instead of sending it. */
const log: EmailProvider = {
  name: 'log',
  delivers: false,
  async send(email) {
    console.log(`[email:log] to=${email.to} subject="${email.subject}"\n${email.text}\n`);
    return { ok: true };
  },
};

export function activeProvider(): EmailProvider | null {
  switch (env.EMAIL_PROVIDER) {
    case 'resend': return resend;
    case 'smtp': return smtp;
    case 'log': return log;
    default: return null;
  }
}
