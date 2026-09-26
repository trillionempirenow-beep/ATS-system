import { env } from '../config/env.js';

export type LocalBroadcast = (channel: string, event: string, payload: unknown) => void;

let localHub: LocalBroadcast | null = null;

/** Development server registers its in-process hub here. */
export function registerLocalHub(fn: LocalBroadcast): void {
  localHub = fn;
}

/**
 * Server-originated realtime events. Best effort by design: every event is
 * backed by state the client can also fetch, so a failed push only delays the
 * update until the next poll.
 */
export async function publish(channel: string, event: string, payload: unknown): Promise<void> {
  try {
    if (env.REALTIME_DRIVER === 'local') {
      localHub?.(channel, event, payload);
      return;
    }
    const res = await fetch(`${env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`,
      },
      body: JSON.stringify({ messages: [{ topic: channel, event, payload, private: false }] }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) console.warn(`[realtime] broadcast ${event} failed: HTTP ${res.status}`);
  } catch (e) {
    console.warn(`[realtime] broadcast ${event} failed`, e instanceof Error ? e.message : e);
  }
}
