import { env } from '../../config/env.js';
import type { N8nEventName } from './n8n.events.js';

export interface N8nConfig {
  enabled: boolean;
  webhookUrl: string | null;
  apiKey: string | null;
  signingSecret: string | null;
  timeoutMs: number;
  /** null = every event. */
  events: Set<string> | null;
}

export function n8nConfig(): N8nConfig {
  const events = env.N8N_EVENTS ? new Set(env.N8N_EVENTS.split(',').map((e) => e.trim()).filter(Boolean)) : null;
  return {
    enabled: env.N8N_ENABLED && Boolean(env.N8N_WEBHOOK_URL),
    webhookUrl: env.N8N_WEBHOOK_URL ?? null,
    apiKey: env.N8N_API_KEY ?? null,
    signingSecret: env.N8N_SIGNING_SECRET ?? null,
    timeoutMs: env.N8N_TIMEOUT_MS,
    events,
  };
}

export function eventEnabled(cfg: N8nConfig, event: N8nEventName): boolean {
  return cfg.enabled && (cfg.events === null || cfg.events.has(event));
}
