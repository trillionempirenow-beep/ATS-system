import { createHmac, randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { sql } from '../../db/client.js';
import { eventEnabled, n8nConfig } from './n8n.config.js';
import type { N8nEventMap, N8nEventName } from './n8n.events.js';

async function record(event: string, payload: unknown, status: 'delivered' | 'failed', httpStatus: number | null, error: string | null) {
  try {
    await sql`insert into integration_events (target, event, payload, status, http_status, error)
              values ('n8n', ${event}, ${sql.json(payload as never)}, ${status}, ${httpStatus}, ${error})`;
  } catch (e) {
    console.error('[n8n] could not record event', e);
  }
}

async function deliver<E extends N8nEventName>(event: E, data: N8nEventMap[E]): Promise<void> {
  const cfg = n8nConfig();
  if (!cfg.webhookUrl) return;
  const envelope = { id: randomUUID(), event, occurredAt: new Date().toISOString(), source: 'acme-people-ats', data };
  const body = JSON.stringify(envelope);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Acme-Event': event };
  if (cfg.apiKey) headers['X-N8N-API-KEY'] = cfg.apiKey;
  if (cfg.signingSecret) headers['X-Acme-Signature'] = `sha256=${createHmac('sha256', cfg.signingSecret).update(body).digest('hex')}`;
  try {
    const res = await fetch(cfg.webhookUrl, { method: 'POST', headers, body, signal: AbortSignal.timeout(cfg.timeoutMs) });
    if (res.ok) await record(event, envelope, 'delivered', res.status, null);
    else await record(event, envelope, 'failed', res.status, (await res.text().catch(() => '')).slice(0, 500));
  } catch (e) {
    await record(event, envelope, 'failed', null, e instanceof Error ? e.message : 'Network error');
  }
}

/**
 * The only function in the codebase that talks to n8n. Call it after the
 * transaction commits. It returns immediately; delivery happens in the
 * background (kept alive on Vercel with waitUntil) and can never fail the
 * request. With N8N_ENABLED=false it does nothing at all.
 */
export function emitN8nEvent<E extends N8nEventName>(event: E, data: N8nEventMap[E]): void {
  if (!eventEnabled(n8nConfig(), event)) return;
  const task = deliver(event, data).catch((e) => console.error('[n8n] delivery crashed', e));
  try {
    waitUntil(task);
  } catch {
    /* outside a Vercel request the promise simply runs on */
  }
}
