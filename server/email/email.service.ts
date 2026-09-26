import { sql } from '../db/client.js';
import type { DeliveryReport } from '../../shared/api/envelope.js';
import { activeProvider } from './providers.js';
import type { RenderedEmail } from './templates/layout.js';

export type EmailOutcome = NonNullable<DeliveryReport['email']>;

export interface EmailResult {
  outcome: EmailOutcome;
  error?: string;
}

/**
 * The single path every email takes. The idempotency key (e.g.
 * "interview-invite:42") makes a repeated call a no-op once a message was sent,
 * so retries, double clicks and a parallel n8n workflow cannot duplicate it.
 * Never throws: callers report the outcome but keep their own transaction.
 */
export async function sendEmail(input: { key: string; template: string; to: string; email: RenderedEmail }): Promise<EmailResult> {
  const provider = activeProvider();
  if (!provider) return { outcome: 'not_configured', error: 'Email delivery is not configured (EMAIL_PROVIDER=none).' };

  try {
    const [claimed] = await sql<{ id: number }[]>`
      insert into email_outbox (idempotency_key, template, to_address, subject, status, provider)
      values (${input.key}, ${input.template}, ${input.to}, ${input.email.subject}, 'sending', ${provider.name})
      on conflict (idempotency_key) do update
        set status = 'sending', attempts = email_outbox.attempts + 1, updated_at = now(), provider = excluded.provider
        where email_outbox.status = 'failed'
      returning id`;
    if (!claimed) return { outcome: 'duplicate' };

    const result = await provider.send({
      to: input.to,
      subject: input.email.subject,
      html: input.email.html,
      text: input.email.text,
      idempotencyKey: input.key,
    });

    if (result.ok) {
      const status = provider.delivers ? 'sent' : 'skipped';
      await sql`update email_outbox set status = ${status}, provider_id = ${result.id ?? null}, error = null, updated_at = now()
                where id = ${claimed.id}`;
      return provider.delivers ? { outcome: 'sent' } : { outcome: 'skipped', error: 'Email is in log mode for development; nothing was delivered.' };
    }
    await sql`update email_outbox set status = 'failed', error = ${result.error.slice(0, 1000)}, updated_at = now() where id = ${claimed.id}`;
    console.warn(`[email] ${input.template} to ${input.to} failed: ${result.error}`);
    return { outcome: 'failed', error: 'The email could not be delivered. The action was saved; you can resend later.' };
  } catch (e) {
    console.error('[email] outbox error', e);
    return { outcome: 'failed', error: 'The email could not be delivered. The action was saved.' };
  }
}

export function toDeliveryReport(result: EmailResult | null): DeliveryReport {
  if (!result) return {};
  return result.error ? { email: result.outcome, emailError: result.error } : { email: result.outcome };
}
