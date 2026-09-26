# Acme People ATS

The Acme applicant tracking system, rebuilt from the PHP app as React + TypeScript on the front and a Node (Express) API on Supabase Postgres, deployable to Vercel.

- **Careers site**: open roles, apply with CV parsing, application status, withdraw, referrals.
- **Recruiting**: overview, drag-and-drop pipeline with stage rules, candidates and profiles (resume versions, analysis, notes, stage reviews), add candidate with CV auto-fill.
- **Interviews**: scheduling (built-in room or external link), reminders, the Acme Room (waiting room, admit, video, screen share, chat, live notes, private scorecard), and reviews.
- **Jobs**: postings with PDF import, the approval workflow, job management.
- **People**: employees (including hired-candidate conversion) and attendance with review and CSV export.
- **Administration**: Admins and seats (Super Admin), HR / Recruiter accounts, password reset approvals, applicant portal, audit trail, settings.
- **Analytics**: personal and team views and the HR / Recruiter report, all from real data.

**New here? Follow `SETUP.md`**: one step-by-step guide from unzip to live site.

`MIGRATION_PLAN.md` records the architecture decisions and how each PHP feature maps to the new code.

## Stack

| Layer | Choice |
|---|---|
| Web | React 19, TypeScript (strict), Vite, React Router, TanStack Query, React Hook Form + Zod, CSS Modules on design tokens (light and dark) |
| API | Express 5, one Vercel function (`api/index.ts`), Zod-validated input, server-side authorization on every route |
| Data | Supabase Postgres via `postgres` (postgres.js); SQL migrations in `supabase/migrations`; RLS enabled on every table (the browser never reads tables directly) |
| Files | Supabase Storage (private buckets) with signed direct uploads, verified server-side |
| Realtime | Supabase Realtime broadcast + presence (interview room, live notifications) |
| Email | `server/email`: Resend or SMTP, idempotent outbox, HTML templates |
| Automation | Optional n8n webhooks in `server/integrations/n8n`, off by default |

## Run it locally

Requirements: Node 20+.

```bash
npm install
cp .env.example .env
```

For local development, set these in `.env`. No external services are needed:

```ini
NODE_ENV=development
APP_URL=http://localhost:5173
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres
DATABASE_POOL_MAX=1
SESSION_SECRET=<any random string, 32+ characters>
CRON_SECRET=<any random string>
STORAGE_DRIVER=local
REALTIME_DRIVER=local
EMAIL_PROVIDER=log
N8N_ENABLED=false
```

Then start everything:

```bash
npm run dev
```

This runs three processes:

- **db**: Postgres (PGlite) on port 54329. On the first run it applies the migrations and loads `supabase/seed.sql`.
- **api**: the API on port 3001.
- **web**: Vite on http://localhost:5173.

The local drivers keep files in `.data/storage`, run realtime over a WebSocket served by the API, and print emails to the API console. They're refused when `NODE_ENV=production`.

Demo accounts (all use the password `password`):

| Email | Role |
|---|---|
| superadmin@acme.test | Super Admin |
| admin@acme.test | Admin |
| recruiter@acme.test | HR / Recruiter |
| manager@acme.test | Hiring Manager |
| employee@acme.test | Employee |

`npm run dev:db -- --reset` wipes the local database and reseeds it.

## Checks

```bash
npm run typecheck      # app and server, strict
npm test               # API integration tests against an in-memory Postgres
npm run check:styles   # CSS Module classes and design tokens that do not exist
npm run build          # typecheck + production build into dist/
```

## Deploy (Supabase + Vercel)

**The easy way:** create an empty Supabase project, then run `npm run setup`. It builds the database, creates your admin login and writes `vercel-env.txt` to paste into Vercel. `SETUP.md` walks through it click by click. The manual steps are below.

1. **Create a Supabase project.** Copy the pooled connection string (Transaction mode, port 6543), the project URL, the anon key and the service-role key.
2. **Apply the schema** from your machine:
   ```bash
   DATABASE_URL="<pooled connection string>" npm run db:migrate
   ```
   This creates the tables, the default settings, and the private storage buckets `resumes`, `photos` and `job-documents`. It's safe to run again: applied migrations are skipped.
3. **Create the first Super Admin** with `npm run db:create-super-admin -- --email you@company.com --name "Your Name"` (it prints a temporary password), or import the legacy data (next section). Don't run `db:seed` on production; it refuses to anyway.
4. **Create the Vercel project** from this folder. The build command, output directory, API function, rewrites and daily reminder cron are all in `vercel.json`. Set the environment variables listed in `.env.example`:
   - `NODE_ENV=production`, `APP_URL` (your domain), `APP_TIMEZONE`
   - `DATABASE_URL` (pooled), `DATABASE_SSL=true`
   - `SESSION_SECRET`, `CRON_SECRET`
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - `STORAGE_DRIVER=supabase`, `REALTIME_DRIVER=supabase`
   - `EMAIL_PROVIDER` with its settings (`RESEND_API_KEY`, or the `SMTP_*` values), `EMAIL_FROM`
5. **Video calls behind strict firewalls**: add a TURN server under Settings → Interview room connectivity. STUN alone connects most networks, but not all.
6. **Reminders**: Vercel Cron calls `/api/v1/cron/interview-reminders` daily (the Hobby plan limit). For reminders an hour before each interview, call that URL every 15 minutes from n8n or any scheduler, with `Authorization: Bearer <CRON_SECRET>`.

Secrets stay on the server. The browser only receives the Supabase URL and the anon key, and with RLS on and no policies, that key can't read or write any table. Realtime channel names are unguessable HMAC keys issued by the API, and only to people allowed to join.

## Move the data from the PHP app

```bash
DATABASE_URL="<target>" npm run db:import-mysql -- \
  --mysql mysql://user:pass@host:3306/acme_ats \
  --files /path/to/ATS-system-main \
  --dry-run
```

Run it with `--dry-run` first to see what will be copied, then run it again without the flag. The importer:

- Copies every table with its ids, then advances the id sequences.
- Only runs into an empty, migrated database, and writes all rows in one transaction, so a failure leaves nothing behind.
- Keeps existing passwords working (PHP bcrypt hashes are accepted) and keeps approved password-reset links valid.
- Uploads resumes, photos and job-description PDFs from the PHP folder into Storage and rewrites their paths. Very old candidates that only had `resume_path` get proper document rows.
- Reads legacy times in `APP_TIMEZONE`, the zone the PHP app wrote them in (override with `--timezone`).

Payroll and leave aren't carried over. The PHP app had already removed them (its migration `017_remove_payroll_leave.sql`).

## n8n (optional)

The ATS works fully without n8n. To send events to a workflow, set these:

```ini
N8N_ENABLED=true
N8N_WEBHOOK_URL=https://your-n8n/webhook/acme
N8N_SIGNING_SECRET=<shared secret>
```

Events (`candidate.created`, `application.stage_changed`, `interview.scheduled`, `interview.ended`, `interview.reviewed`, and others) are posted after the database commit. They're signed with `X-Acme-Signature` (HMAC-SHA256 of the body) when a secret is set. Failures are logged in `integration_events` and never block the user. `N8N_EVENTS` limits which events are sent.

## Project layout

```
api/index.ts               Vercel function entry (the Express app)
server/                    API: config, db, middleware, core services, modules/<feature>, email, storage, realtime, parsers
shared/                    Types, Zod schemas and domain rules used by both server and web
src/                       Web app: app shell, router and guards, design system, features/<area>
supabase/migrations/       Schema, reference data, storage buckets
supabase/seed.sql          Demo data for development
scripts/                   dev database, migrate, seed, MySQL import, style check
tests/                     API integration tests
```

## Known limits

- **Acme Assist** (AI notes during interviews) needs a transcription provider, and none is configured. The room says so, and interviewers use their own notes, flagged moments and the scorecard. The data model and review screen are ready for it.
- The built-in room is a small mesh call, which suits interviews of up to about four people.
