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

  EMAIL_PROVIDER: z.enum(['resend', 'smtp', 'log', 'none']).default('log'),
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

  TRUST_PROXY: bool,
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
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
