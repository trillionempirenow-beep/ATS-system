/**
 * Guided production setup: asks for the few values you copy from Supabase, then
 *   1. creates the database tables and file storage in your Supabase project,
 *   2. creates your Super Admin login,
 *   3. writes vercel-env.txt, ready to paste into Vercel, with the secrets generated for you.
 *
 *   npm run setup
 *   npm run setup -- --skip-admin   (when you will import the old PHP data instead)
 *
 * Nothing is sent anywhere except your own Supabase database. vercel-env.txt holds
 * secrets: paste it into Vercel, then delete it (it is ignored by git).
 */
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { runMigrations } from './lib/migrations.js';
import { createSuperAdmin, isEmail } from './lib/super-admin.js';
import { connectTarget } from './lib/target-db.js';

const { values: flags } = parseArgs({ options: { 'skip-admin': { type: 'boolean', default: false } } });
const rl = createInterface({ input, output, terminal: false });
// Reading lines in order (instead of rl.question) keeps pasted multi-line input from being dropped.
const lines = rl[Symbol.asyncIterator]();
async function readLine(prompt: string): Promise<string> {
  output.write(prompt);
  const next = await lines.next();
  if (next.done) {
    console.log('');
    console.log(red('  Input ended before setup finished. Run "npm run setup" again.'));
    process.exit(1);
  }
  return next.value;
}
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

/** Asks until the answer passes the check. An empty answer returns the fallback when one is given. */
async function ask(question: string, where: string, check: (v: string) => string | null, fallback?: string): Promise<string> {
  console.log(`\n${bold(question)}`);
  console.log(dim(`  Where: ${where}`));
  for (;;) {
    const answer = (await readLine(fallback !== undefined ? '  > (Enter to skip) ' : '  > ')).trim();
    if (!answer && fallback !== undefined) return fallback;
    const problem = check(answer);
    if (!problem) return answer;
    console.log(red(`  ${problem} Try again.`));
  }
}

const secret = () => randomBytes(32).toString('hex');

console.log(`
${bold('Acme People ATS: production setup')}
You need your Supabase project open in the browser (see SETUP.md, part 3).
Paste each value and press Enter.`);

const supabaseUrl = await ask(
  '1/6  Supabase Project URL',
  'Supabase → your project → Project Settings → Data API → "Project URL" (looks like https://abcd1234.supabase.co)',
  (v) => (/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(v) ? null : 'That does not look like https://xxxx.supabase.co.'),
).then((v) => v.replace(/\/$/, ''));

const anonKey = await ask(
  '2/6  Supabase anon (public) key',
  'Project Settings → API Keys → "anon" / "publishable" key (safe for the browser)',
  (v) => (/^(eyJ|sb_publishable_)/.test(v) ? null : 'The anon key starts with "eyJ" or "sb_publishable_".'),
);

const serviceKey = await ask(
  '3/6  Supabase service_role (secret) key',
  'Same page → "service_role" / "secret" key. Keep it private: it only goes to Vercel.',
  (v) => (/^(eyJ|sb_secret_)/.test(v) ? (v === anonKey ? 'That is the anon key; the secret key is a different one.' : null) : 'The secret key starts with "eyJ" or "sb_secret_".'),
);

const databaseUrl = await ask(
  '4/6  Database connection string (Transaction pooler)',
  'Top of the project → "Connect" button → Transaction pooler → copy the URI, and put your database password in place of [YOUR-PASSWORD]',
  (v) => {
    if (!/^postgres(ql)?:\/\//.test(v)) return 'It should start with postgresql://';
    if (v.includes('[YOUR-PASSWORD]')) return 'Replace [YOUR-PASSWORD] with your database password first.';
    if (!v.includes(':6543')) return 'Use the Transaction pooler string (port 6543), not the direct one.';
    return null;
  },
);

const appUrl = await ask(
  '5/6  Your website address on Vercel',
  'The name you will give the Vercel project, e.g. https://acme-ats.vercel.app (you can change it later in Vercel)',
  (v) => (/^https:\/\/[^\s/]+$/.test(v) ? null : 'Use the form https://your-name.vercel.app with no slash at the end.'),
);

const resendKey = await ask(
  '6/6  Resend API key for sending emails (optional)',
  'resend.com → API Keys. Skip for now if you have not set up Resend; the app works and you can add it later (SETUP.md, part 6).',
  (v) => (v.startsWith('re_') ? null : 'Resend keys start with "re_".'),
  '',
);
const emailFrom = resendKey
  ? await ask('     Sender address for emails', 'An address on the domain you verified in Resend, e.g. careers@yourcompany.com', (v) => (isEmail(v) ? null : 'That is not an email address.'))
  : 'careers@example.com';

// --- 1. database -------------------------------------------------------------
console.log(`\n${bold('Creating the database tables and file storage…')}`);
process.env.DATABASE_URL = databaseUrl;
const { sql, executor } = connectTarget();
let adminLine = '';
try {
  const applied = await runMigrations(executor, (m) => console.log(dim(`  ${m}`)));
  console.log(green(applied ? `  Done: ${applied} setup step(s) applied.` : '  Already set up: nothing to change.'));

  // --- 2. first login --------------------------------------------------------
  const [row] = await sql<{ count: number }[]>`select count(*)::int as count from users where role = 'super_admin'`;
  if (flags['skip-admin']) {
    console.log(dim('  Skipped creating a login (--skip-admin): the database stays empty for the PHP data import.'));
  } else if ((row?.count ?? 0) > 0) {
    console.log(dim('  A Super Admin already exists, so none was created.'));
  } else {
    const email = await ask('Your email for the Super Admin login', 'The address you will sign in with', (v) => (isEmail(v) ? null : 'That is not an email address.'));
    const name = await ask('Your full name', 'Shown in the app and on audit records', (v) => (v.length ? null : 'Please enter a name.'));
    const password = await createSuperAdmin(sql, email, name);
    if (password) adminLine = `  Sign in at ${appUrl}/login\n  Email:              ${email}\n  Temporary password: ${bold(password)}\n  Change it after signing in: My profile → Change password.`;
  }
} catch (e) {
  console.log(red(`\n  Could not reach or set up the database: ${e instanceof Error ? e.message : String(e)}`));
  console.log('  Check the connection string and password (SETUP.md, part 9), then run "npm run setup" again. It is safe to repeat.');
  await sql.end();
  rl.close();
  process.exit(1);
}
await sql.end();

// --- 3. Vercel settings ------------------------------------------------------
const vars: Array<[string, string]> = [
  ['NODE_ENV', 'production'],
  ['APP_URL', appUrl],
  ['APP_TIMEZONE', 'Asia/Manila'],
  ['DATABASE_URL', databaseUrl],
  ['DATABASE_SSL', 'true'],
  ['DATABASE_POOL_MAX', '3'],
  ['SESSION_SECRET', secret()],
  ['CRON_SECRET', secret()],
  ['TRUST_PROXY', 'true'],
  ['SUPABASE_URL', supabaseUrl],
  ['SUPABASE_SERVICE_ROLE_KEY', serviceKey],
  ['VITE_SUPABASE_URL', supabaseUrl],
  ['VITE_SUPABASE_ANON_KEY', anonKey],
  ['STORAGE_DRIVER', 'supabase'],
  ['REALTIME_DRIVER', 'supabase'],
  ['EMAIL_PROVIDER', resendKey ? 'resend' : 'log'],
  ['EMAIL_FROM', `Acme People <${emailFrom}>`],
  ...(resendKey ? [['RESEND_API_KEY', resendKey] as [string, string]] : []),
  ['N8N_ENABLED', 'false'],
];
const quote = (v: string) => (/[\s"<>#]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v);
await writeFile('vercel-env.txt', `${vars.map(([k, v]) => `${k}=${quote(v)}`).join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
rl.close();

console.log(`
${green(bold('Setup finished.'))}

${bold('Database:')} ready in your Supabase project (tables + private storage buckets).
${adminLine ? `${bold('Your login:')}\n${adminLine}\n` : ''}
${bold('Vercel settings:')} saved in ${bold('vercel-env.txt')} (${vars.length} values, secrets already generated).
  1. Vercel → your project → Settings → Environment Variables.
  2. Click into the first "Key" box and paste the ${bold('whole')} contents of vercel-env.txt.
     Vercel splits it into separate variables by itself.
  3. Tick Production (and Preview if you use it) → Save.
  4. Deployments → Redeploy.
  5. Delete vercel-env.txt from your computer afterwards: it contains secrets.
${resendKey ? '' : `\n${dim('Emails are off (EMAIL_PROVIDER=log) until you add Resend: see SETUP.md, part 6.')}`}`);
