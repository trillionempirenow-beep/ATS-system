import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const optionalUrl = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined))
  .pipe(z.string().url().optional());

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:5173'),
  APP_TIMEZONE: z.string().default('Asia/Manila'),
  PORT: z.coerce.number().int().positive().default(3001),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (Supabase: use the pooled connection string, port 6543)'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(5),
  DATABASE_SSL: bool,

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  CRON_SECRET: optionalString,

  SUPABASE_URL: optionalUrl,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,

  STORAGE_DRIVER: z.enum(['supabase', 'local']).default('supabase'),
  LOCAL_STORAGE_DIR: z.string().default('.data/storage'),

  REALTIME_DRIVER: z.enum(['supabase', 'local']).default('supabase'),

  // TURN relay for interview calls. Without one, calls between networks behind
  // carrier-grade NAT (most mobile data and many home ISPs) cannot connect.
  // Cloudflare Realtime TURN: short-lived credentials are generated per request.
  CLOUDFLARE_TURN_KEY_ID: optionalString,
  CLOUDFLARE_TURN_API_TOKEN: optionalString,
  // Any other TURN provider (Metered, Twilio, self-hosted coturn): comma-separated URLs.
  TURN_URLS: optionalString,
  TURN_USERNAME: optionalString,
  TURN_CREDENTIAL: optionalString,

  EMAIL_PROVIDER: z.enum(['resend', 'smtp', 'n8n', 'log', 'none']).default('log'),
  // EMAIL_PROVIDER=n8n: the "ATS - Send email via Gmail" workflow sends from the connected Gmail.
  EMAIL_N8N_WEBHOOK_URL: optionalUrl,
  EMAIL_N8N_SECRET: optionalString,
  EMAIL_FROM: z.string().default('Acme People <no-reply@example.com>'),
  EMAIL_REPLY_TO: optionalString,
  RESEND_API_KEY: optionalString,
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_SECURE: bool,

  N8N_ENABLED: bool,
  N8N_WEBHOOK_URL: optionalUrl,
  N8N_API_KEY: optionalString,
  N8N_SIGNING_SECRET: optionalString,
  N8N_TIMEOUT_MS: z.coerce.number().int().positive().default(4000),
  N8N_EVENTS: optionalString,

  // CV auto-fill with AI, first configured wins: an n8n workflow (CV_N8N_WEBHOOK_URL,
  // called with header X-ATS-Secret: CV_N8N_SECRET), Gemini, then Claude. With none
  // the rule-based parser is used.
  CV_N8N_WEBHOOK_URL: optionalUrl,
  // Create job posting > upload a job description: the ATS-system workflow's JD reader.
  JD_N8N_WEBHOOK_URL: optionalUrl,
  CV_N8N_SECRET: optionalString,
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  RESUME_AI_MODEL: optionalString,

  TRUST_PROXY: bool,
});

export type Env = z.infer<typeof schema>;

/** Settings the app cannot run without: a bad value here stops it with a clear message. */
const CORE_KEYS = new Set(['NODE_ENV', 'APP_URL', 'DATABASE_URL', 'SESSION_SECRET', 'STORAGE_DRIVER', 'REALTIME_DRIVER', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
const CHOICE_KEYS = new Set(['NODE_ENV', 'STORAGE_DRIVER', 'REALTIME_DRIVER', 'EMAIL_PROVIDER']);

/**
 * Values pasted into a dashboard often carry stray spaces, a trailing newline,
 * wrapping quotes or different capitals ("n8n ", "\"https://...\"", "N8N").
 * Clean those up rather than refuse to start over them.
 */
function tidy(key: string, raw: string): string {
  let v = raw.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1).trim();
  return CHOICE_KEYS.has(key) ? v.toLowerCase() : v;
}

function load(): Env {
  const provided: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    const clean = tidy(k, v);
    if (clean !== '') provided[k] = clean;
  }
  let parsed = schema.safeParse(provided);
  if (!parsed.success) {
    // An invalid optional setting (an integration URL, a provider name) turns that
    // feature off with a warning; it must not take sign-in and everything else down.
    const bad = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '')))];
    const optional = bad.filter((k) => k && !CORE_KEYS.has(k));
    if (optional.length && optional.length === bad.length) {
      for (const i of parsed.error.issues) {
        console.error(`[config] ignoring ${i.path.join('.')}: ${i.message}. Fix it in the environment variables and redeploy.`);
      }
      for (const k of optional) delete provided[k];
      parsed = schema.safeParse(provided);
    }
  }
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid server configuration:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  if (env.STORAGE_DRIVER === 'supabase' || env.REALTIME_DRIVER === 'supabase') {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when STORAGE_DRIVER or REALTIME_DRIVER is "supabase".');
    }
  }
  if (env.NODE_ENV === 'production' && (env.STORAGE_DRIVER === 'local' || env.REALTIME_DRIVER === 'local')) {
    throw new Error('The local storage and realtime drivers are development-only. Use "supabase" in production.');
  }
  return env;
}

export const env: Env = load();
export const isProduction = env.NODE_ENV === 'production';
