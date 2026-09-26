# Acme People ATS — migration plan and status

## Architecture decisions (where the brief and blueprint differ)

| Topic | Blueprint | Decision | Why |
|---|---|---|---|
| Database | MySQL + Prisma | Supabase Postgres, `postgres` driver, SQL migrations in `supabase/migrations` | Brief requires Supabase; transactions and row locks (applicant limit) need real SQL |
| API | Fastify, long-running | Express 5 app, exported as one Vercel function (`api/index.ts`) | Vercel serverless |
| Realtime | WebSocket gateway at `/ws` | Supabase Realtime broadcast + presence; channel names are HMAC capability keys issued by the API; server-originated events via Supabase broadcast REST. Local dev uses an in-process WS hub | Vercel cannot host WebSockets |
| Auth | Session cookie + CSRF | Same: `sessions` table, HTTP-only cookie, CSRF header. Existing bcrypt `$2y$` hashes verified as-is | Super-Admin-approved password resets and account statuses don't fit Supabase Auth's flows; keeps existing credentials |
| Uploads | Stream through API | Signed direct-to-Storage uploads (`pending_uploads`), then verified server-side | Vercel 4.5 MB body limit; resumes are up to 10 MB |
| Email | Resend | `EmailService` with resend / smtp / log providers, `email_outbox` idempotency keys | Works with n8n off; no duplicate sends |
| n8n | — | `server/integrations/n8n` only; `N8N_ENABLED=false` by default; emitted after commit, failures logged to `integration_events` | Optional, never on the critical path |
| Reminders | Scheduler | `/api/v1/cron/interview-reminders` guarded by `CRON_SECRET` (Vercel Cron; Hobby plan = daily, or call from n8n) | Serverless |
| Acme Assist AI notes | New, behind a flag | Tables and endpoints built; UI shows "not configured" until a transcription provider is chosen. Scorecard ratings and flagged moments are fully functional | No fake features |
| Homepage stats | Shows "4.7/5 rating" etc. | Only real figures from the database | Brief forbids fake statistics |
| Payroll and leave | — | Not carried over | The PHP app had removed them (migration `017_remove_payroll_leave.sql`); only unlinked legacy pages remained |

## Status

Everything in the PHP app and every blueprint board is implemented:

- **API**: every feature module in `server/modules`, with Zod validation, server-side guards on each route, rate limits, CSRF, audit logging, email outbox and n8n events. Covered by 16 integration tests (auth, full interview lifecycle, job approval, seats, password reset, attendance, careers rules).
- **Web**: every page and state in the blueprint, including loading, empty and error states, 403/404/500 and the session-ended screen, in light and dark themes. Layouts respond to the content width (container queries), so they also hold up beside the sidebar on tablets.
- **Interview room**: device check with the blocked-permission state, waiting room, admit, mesh WebRTC over realtime signalling (perfect negotiation, per-connection session ids), screen share, raise hand, chat, participants, autosaved notes, private scorecard, flagged moments, end for everyone, ended screens, and review.
- **Scripts**: `db:migrate` (idempotent), `db:seed` (development only; refuses non-empty databases and production), `db:import-mysql` (empty-target only, single transaction, ids preserved, files moved to Storage, legacy password hashes and approved reset links kept).
- **Deployment**: `vercel.json` (function, rewrites, cron, headers), `.env.example`, README.

### Verified in the browser (local drivers)
Careers home; sign-in; recruiter overview; candidates and every profile tab; running an application analysis; scheduling an interview; the candidate lobby, device check (camera blocked in the test browser, so the "Join without them" path), waiting room and cancel; the staff summary, admit, notes autosave, cross-tab chat, scorecard, end meeting, both ended screens, review validation and submission; add candidate, pipeline, jobs (mine, editor, management, approvals, review); employees; attendance; analytics; notifications; profile; all Admin and Super Admin pages; light theme; phone width.

### Not verifiable in this environment
- Camera and microphone media: the test browser blocks capture. Signalling, presence, chat and admission were exercised end to end; real audio and video need a normal browser.
- `db:import-mysql` against a real MySQL server: no MySQL was available here. It typechecks, and its column mapping was derived from the legacy schema; run it with `--dry-run` first.
- Supabase: migrations and the Supabase drivers are written for it, but no project could be created (free-tier project limit). Apply with `npm run db:migrate` once a project exists.

## Windows note
In this sandbox, run node tooling through PowerShell (esbuild cannot be spawned from Git Bash here).
