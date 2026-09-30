import type { RtcConfigDto } from '../../shared/api/interviews.js';
import { env } from '../config/env.js';

type IceServer = RtcConfigDto['iceServers'][number];

const CREDENTIAL_TTL_SECONDS = 24 * 60 * 60;
/** Reuse generated credentials for a while; they stay valid for a day. */
const REUSE_MS = 6 * 60 * 60 * 1000;
/** After a failure, try Cloudflare again soon rather than on every request. */
const RETRY_MS = 60 * 1000;

let cloudflare: { at: number; servers: IceServer[] } | null = null;
let lastFailure: { at: number; message: string } | null = null;

/** Browsers stall on TURN over port 53, so Cloudflare recommends leaving those URLs out. */
const withoutPort53 = (s: IceServer): IceServer | null => {
  const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u));
  return urls.length ? { ...s, urls } : null;
};

async function cloudflareServers(): Promise<{ servers: IceServer[]; status: string }> {
  if (!env.CLOUDFLARE_TURN_KEY_ID || !env.CLOUDFLARE_TURN_API_TOKEN) {
    const missing = [!env.CLOUDFLARE_TURN_KEY_ID && 'CLOUDFLARE_TURN_KEY_ID', !env.CLOUDFLARE_TURN_API_TOKEN && 'CLOUDFLARE_TURN_API_TOKEN'].filter(Boolean);
    return { servers: [], status: `Cloudflare TURN not configured (missing ${missing.join(' and ')})` };
  }
  if (cloudflare && Date.now() - cloudflare.at < REUSE_MS) return { servers: cloudflare.servers, status: 'Cloudflare TURN ok' };
  if (lastFailure && Date.now() - lastFailure.at < RETRY_MS) return { servers: cloudflare?.servers ?? [], status: lastFailure.message };
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.CLOUDFLARE_TURN_KEY_ID)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
      const hint = res.status === 401 || res.status === 403 || res.status === 404
        ? ' Check that CLOUDFLARE_TURN_KEY_ID is a TURN key\'s "Turn Token ID" (Realtime > TURN Server), not an SFU "App ID", and that the API token belongs to that same TURN key.'
        : '';
      throw new Error(`HTTP ${res.status}${detail ? ` ${detail}` : ''}.${hint}`);
    }
    const body = (await res.json()) as { iceServers?: IceServer[] | IceServer };
    const list = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
    const servers = list.map(withoutPort53).filter((s): s is IceServer => s !== null);
    cloudflare = { at: Date.now(), servers };
    lastFailure = null;
    return { servers, status: servers.length ? 'Cloudflare TURN ok' : 'Cloudflare TURN returned no servers' };
  } catch (e) {
    const message = `Cloudflare TURN failed: ${e instanceof Error ? e.message : String(e)}`;
    console.warn(`[ice] ${message}`);
    lastFailure = { at: Date.now(), message };
    return { servers: cloudflare?.servers ?? [], status: message };
  }
}

function staticTurn(): IceServer[] {
  const urls = env.TURN_URLS?.split(',').map((u) => u.trim()).filter(Boolean) ?? [];
  if (!urls.length) return [];
  return [{ urls, ...(env.TURN_USERNAME ? { username: env.TURN_USERNAME } : {}), ...(env.TURN_CREDENTIAL ? { credential: env.TURN_CREDENTIAL } : {}) }];
}

/**
 * TURN relays configured through the environment, added to the servers from
 * settings, and a one-line status the browser logs so a broken setup is visible.
 */
export async function turnServers(): Promise<{ servers: IceServer[]; status: string }> {
  const cf = await cloudflareServers();
  const fixed = staticTurn();
  const status = fixed.length ? `${cf.status}; static TURN (TURN_URLS) configured` : cf.status;
  return { servers: [...cf.servers, ...fixed], status };
}
