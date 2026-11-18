# Security

What protects the system, where it lives in the code, and what to set up outside the code.

## In the code

| Threat | Protection | Where |
|---|---|---|
| SQL injection | Every query is parameterized (postgres.js tagged templates); raw SQL only in dev scripts with fixed table names. Request bodies, queries and ids are validated with zod before use. | `server/db`, `shared/api/*` |
| Cross-site scripting | React escapes output; emails escape every value. A Content-Security-Policy allows scripts only from this site (no inline scripts, no `eval`). | `server/http/security-headers.ts`, `server/email/templates/layout.ts` |
| Clickjacking | `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`: no other site can put the app in a frame. | `server/http/security-headers.ts` |
| Cross-site requests (CSRF) | State-changing requests must come from this site's origin and, when signed in, carry the session's CSRF token. Session cookie: HttpOnly, SameSite=Lax, Secure and `__Host-` in production. | `server/middleware/security.ts`, `server/middleware/session.ts` |
| Password guessing | Per address: 20 sign-ins / 15 min. Per account and address: 8 / 15 min, so a stranger cannot lock someone out from that person's own address. Per account from anywhere: 100 / hour. bcrypt (cost 12); the same answer and the same work for unknown emails. | `server/modules/auth/auth.routes.ts` |
| Weak passwords | New and changed passwords (and temporary ones): 12+ characters, a letter and a number, and not a common password or an obvious variant of one ("Password2024!"). Existing passwords keep working. | `shared/domain/access.ts` |
| Account takeover by reset | A reset is a request a Super Admin approves; the emailed link is single-use and expires. | `server/modules/auth`, `server/modules/admin` |
| Snooping on applicants | An application's status page opens only from the signed link in the applicant's emails (HMAC of the ID and email with `SESSION_SECRET`). Typing an email only sends that inbox its links, and the page never says whether the address applied. Withdrawing needs the same link. | `server/lib/status-links.ts`, `src/features/careers/StatusPage.tsx` |
| Malicious uploads | The real file type is read from its first bytes; size limits; private storage; downloads through short-lived signed links. | `server/modules/uploads` |
| Floods (the app's share) | Every request first passes a per-address budget kept in memory (`API_RATE_LIMIT_PER_MINUTE`, default 600/min), before any database work; past it, 429 with `Retry-After`. Sensitive actions have their own database-backed limits shared by all instances. Bodies are capped at 1 MB; slow requests are cut off. The careers pages may be cached by the CDN for 30 seconds, so a flood of visitors is served from the edge. | `server/middleware/flood.ts`, `server/modules/public/public.routes.ts` |
| Known-vulnerable libraries | `npm audit --omit=dev` reports 0 vulnerabilities (November 2026). Run it before each release. | `package.json` |

The browser security headers are defined once in `server/http/security-headers.ts`. Express sends them on every response; `vercel.json` repeats the production set for Vercel's static hosting, and `tests/api/security.test.ts` fails if the two drift apart.

## To set up on Vercel (not in the code)

A large attack (thousands of addresses, or traffic measured in gigabits) has to be stopped before it reaches the app. Vercel blocks network-level floods on its own; these settings cover application-level ones. Check which are included in your plan.

1. **Firewall → a rate-limit rule for `/api/`.** For example, 300 requests per minute per IP address, action: deny for a few minutes. This complements the app's own limit, which counts per server instance.
2. **Attack Challenge Mode.** Turn it on while under attack: visitors get a browser check before reaching the site. Turn it off afterwards (it also challenges legitimate scripts).
3. **Bot protection / managed rulesets**, where available on your plan.
4. Keep **`TRUST_PROXY=true`** on Vercel: the per-address limits rely on the real client address.

## Testing the Content-Security-Policy

`npm run build && npx vite preview` serves the built app with the same headers (minus the https-only ones). Open it with the API running and watch the browser console for "Content Security Policy" messages. If you move storage or realtime to a custom Supabase domain, add it next to `SUPABASE` in `server/http/security-headers.ts`.

The browser build sets zod to `jitless` (`src/lib/zodConfig.ts`): zod's faster validators use `eval`, which the policy forbids.

## Operational notes

- **`SESSION_SECRET`** also signs applicants' status links. Changing it retires every link already emailed; applicants request new ones by entering their email on the status page.
- **Status links in emails sent before this change** have no signature. They open the status page with a notice asking for the email address, and the applicant gets fresh links by email.

## Not covered yet

- **Two-step sign-in** (authenticator codes) for staff. Deliberately left for a separate piece of work.
- Notifying a user when their account sees repeated failed sign-ins.
