import type { RtcConfigDto } from '../../shared/api/interviews.js';
import { env } from '../config/env.js';

type IceServer = RtcConfigDto['iceServers'][number];

const CREDENTIAL_TTL_SECONDS = 24 * 60 * 60;
/** Reuse generated credentials for a while; they stay valid for a day. */
const REUSE_MS = 6 * 60 * 60 * 1000;

let cloudflare: { at: number; servers: IceServer[] } | null = null;

/** Browsers stall on TURN over port 53, so Cloudflare recommends leaving those URLs out. */
const withoutPort53 = (s: IceServer): IceServer | null => {
  const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u));
  return urls.length ? { ...s, urls } : null;
};

async function cloudflareServers(): Promise<IceServer[]> {
  if (!env.CLOUDFLARE_TURN_KEY_ID || !env.CLOUDFLARE_TURN_API_TOKEN) return [];
  if (cloudflare && Date.now() - cloudflare.at < REUSE_MS) return cloudflare.servers;
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.CLOUDFLARE_TURN_KEY_ID)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { iceServers?: IceServer[] | IceServer };
    const list = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
    const servers = list.map(withoutPort53).filter((s): s is IceServer => s !== null);
    cloudflare = { at: Date.now(), servers };
    return servers;
  } catch (e) {
    console.warn('[ice] Cloudflare TURN credentials failed', e instanceof Error ? e.message : e);
    return cloudflare?.servers ?? [];
  }
}

function staticTurn(): IceServer[] {
  const urls = env.TURN_URLS?.split(',').map((u) => u.trim()).filter(Boolean) ?? [];
  if (!urls.length) return [];
  return [{ urls, ...(env.TURN_USERNAME ? { username: env.TURN_USERNAME } : {}), ...(env.TURN_CREDENTIAL ? { credential: env.TURN_CREDENTIAL } : {}) }];
}

/** TURN relays configured through the environment, added to the servers from settings. */
export async function turnServers(): Promise<IceServer[]> {
  return [...(await cloudflareServers()), ...staticTurn()];
}

export const turnConfigured = (): boolean => Boolean((env.CLOUDFLARE_TURN_KEY_ID && env.CLOUDFLARE_TURN_API_TOKEN) || env.TURN_URLS);
