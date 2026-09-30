# Acme People ATS: setup guide

This guide takes you from the zip to a live website, one step at a time.

## How the pieces fit

```
  Your computer                Supabase (free)                 Vercel (free)
  ─────────────                ───────────────                 ─────────────
  acme-ats folder  ──setup──►  DATABASE: all candidates,       WEBSITE + API: what people
  (from the zip)               jobs, users, interviews…        open in the browser
                               FILES: resumes, photos, PDFs    (reads/writes the database)
                               LIVE UPDATES: interview room
```

- **The database lives in Supabase.** It doesn't exist yet: you create an empty Supabase project, and the `npm run setup` command builds all the tables inside it.
- **The website lives on Vercel.** You upload the code, then paste in a settings file that `npm run setup` writes for you.

| Step | What you do | Time |
|---|---|---|
| 1 | Install Node, unzip, `npm install` | 5 min |
| 2 | Create the Supabase project (the database) | 5 min |
| 3 | Run `npm run setup`: it builds the database and writes your Vercel settings | 5 min |
| 4 | Put the website on Vercel and paste the settings | 10 min |
| 5 | Sign in | 1 min |
| — | Optional: email sending, old PHP data, extras, troubleshooting | — |

---

## Step 1: Install and unzip

1. Install **Node.js** (the "LTS" version) from https://nodejs.org.
2. Unzip `acme-ats.zip`. You get a folder called `acme-ats`.
3. Open a terminal **inside that folder**. On Windows: open the folder, click the address bar, type `powershell`, and press Enter.
4. Run:
   ```bash
   npm install
   ```
   Wait until it finishes (1–3 minutes).

Want to see the app first without any accounts? See [Try it on your computer](#try-it-on-your-computer-optional) at the end.

---

## Step 2: Create the database (Supabase project)

### 2a. Make room: the free plan allows 2 projects

Your Supabase account already has 2 projects (`foldnote` and `smilecare-v2`). Pause one you aren't using:

> Supabase → open that project → **Project Settings** → **General** → **Pause project**

Pausing keeps all its data, and you can restore it anytime. Or upgrade to the Pro plan instead.

### 2b. Create the project

1. Go to https://supabase.com/dashboard → **New project**.
2. Fill in:
   - **Name:** `acme-ats`
   - **Database password:** click **Generate a password** and **copy it into a note now**. You'll need it in Step 3.
   - **Region:** **Southeast Asia (Singapore)**
3. Click **Create new project** and wait about 2 minutes until it's ready.

That's it. The project is an empty database for now; Step 3 fills it.

---

## Step 3: Run the setup command

In the terminal (inside the `acme-ats` folder), run:

```bash
npm run setup
```

It asks **6 questions**. For each one, copy the value from Supabase, paste it into the terminal and press Enter. If something looks wrong, it tells you and asks again.

| # | It asks for | Where to click in Supabase | Looks like |
|---|---|---|---|
| 1 | **Project URL** | Project → **Project Settings** (gear icon) → **Data API** → *Project URL* | `https://abcd1234.supabase.co` |
| 2 | **anon key** (public) | Project Settings → **API Keys** → the **anon** / **publishable** key → Copy | `eyJhbGci…` or `sb_publishable_…` |
| 3 | **service_role key** (secret) | Same page → **service_role** / **secret** key → Reveal → Copy | `eyJhbGci…` or `sb_secret_…` |
| 4 | **Connection string** | Top of the project page → **Connect** button → **Transaction pooler** → copy the URI. Then **replace `[YOUR-PASSWORD]`** with the password from Step 2b. | `postgresql://postgres.abcd:MyPass@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres` |
| 5 | **Website address** | Nothing to copy: choose the name for your Vercel site now | `https://acme-ats.vercel.app` |
| 6 | **Resend key** (optional) | Press **Enter** to skip for now (see [Sending emails](#optional-sending-emails)) | `re_…` |

Then it asks for **your email and name** to create your admin login.

When it finishes, three things are done:

1. **The database is built:** all tables plus the private storage for resumes, photos and PDFs. You can see them in Supabase → **Table Editor** and **Storage**.
2. **Your login is created.** It shows your **temporary password once**, so copy it.
3. **A file called `vercel-env.txt`** is created in the folder, containing all your Vercel settings. The secret codes are generated for you.

It's safe to run `npm run setup` again at any time: it never deletes or duplicates anything.

---

## Step 4: Put the website on Vercel

### 4a. Upload the code

Pick one way.

**Way A: GitHub (easiest to update later)**
1. On https://github.com create a **new private repository** (e.g. `acme-ats`).
2. Upload everything **inside** the `acme-ats` folder. Use "uploading an existing file" and drag the contents in, but **not** `node_modules` or `vercel-env.txt`.
3. On https://vercel.com → **Add New… → Project** → **Import** that repository.
4. The project name gives your website address. Use the same name you typed in question 5 (e.g. `acme-ats` gives `https://acme-ats.vercel.app`).
5. Leave every build setting as it is and click **Deploy**. The first deploy may show an error because the settings aren't added yet. That's normal: continue with 4b.

**Way B: from the terminal**
```bash
npx vercel
```
Log in when asked and accept the suggestions. Use the same project name as in question 5.

### 4b. Paste the settings (environment variables)

1. Open the file **`vercel-env.txt`** (in the `acme-ats` folder) with Notepad and **copy everything** (Ctrl+A, Ctrl+C).
2. Vercel → your project → **Settings** → **Environment Variables**.
3. Click into the first **Key** box and **paste** (Ctrl+V). Vercel automatically splits it into all 18 settings.
4. Under Environments, keep **Production** ticked (add Preview too if you like) → **Save**.
5. Go to **Deployments** → click **⋯** on the latest one → **Redeploy**.
6. When it shows **Ready**, **delete `vercel-env.txt`** from your computer. It contains secret keys.

### What the settings mean

You don't need to type any of these; the file already has them. This table is just so you know what each one is.

| Setting | What it is | Where it came from |
|---|---|---|
| `NODE_ENV` | Tells the app it's the live site | Fixed: `production` |
| `APP_URL` | Your website address | Question 5 |
| `APP_TIMEZONE` | Time zone for interviews and attendance | Fixed: `Asia/Manila` |
| `DATABASE_URL` | How the website reaches the database | Question 4 (Supabase **Connect** button) |
| `DATABASE_SSL`, `DATABASE_POOL_MAX` | Secure connection, connection limit | Fixed: `true`, `3` |
| `SESSION_SECRET` | Secret that protects sign-ins | **Generated for you** |
| `CRON_SECRET` | Password for the reminder job | **Generated for you** |
| `TRUST_PROXY` | Needed on Vercel | Fixed: `true` |
| `SUPABASE_URL` | Your Supabase project address | Question 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key the server uses for files and live updates (never shown to visitors) | Question 3 |
| `VITE_SUPABASE_URL` | Same address, for the browser's live updates | Question 1 |
| `VITE_SUPABASE_ANON_KEY` | Public key for live updates; it can't read your data | Question 2 |
| `STORAGE_DRIVER`, `REALTIME_DRIVER` | Use Supabase for files and live updates | Fixed: `supabase` |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY` | How emails are sent | Question 6 (`log` means emails are off for now) |
| `N8N_ENABLED` | Optional automations | Fixed: `false` |

To change one later: Vercel → Settings → Environment Variables → click the setting → **Edit** → Save → **Redeploy**. Changes only take effect after a redeploy.

---

## Step 5: Sign in

1. Open your website, e.g. `https://acme-ats.vercel.app`.
2. Click **Recruiter hub** and sign in with the email and **temporary password** from Step 3.
3. Go to **My profile → Change password** right away.
4. Then set up your team:
   1. **Settings:** company name, careers headline, logo.
   2. **Admins:** create your Admins and give each one HR / Recruiter seats.
   3. Admins create **HR / Recruiter** accounts, and you approve them.

🎉 The ATS is live.

---

## Smart CV auto-fill (AI)

Without it, "Upload a CV" only recognises CVs laid out the way the built-in rules
expect. With it, an AI model reads any CV (two columns, tables, creative designs,
scanned PDFs) and fills in name, email, phone, current title, experience level,
skills and education. The recruiter still checks every field before saving, and if
the AI is unavailable (no key, quota used up, outage) the built-in rules are used.

**Google Gemini (free tier available)**
1. Sign in at **aistudio.google.com/apikey** and click **Create API key**.
2. In Vercel add `GEMINI_API_KEY` = the key (mark it **Sensitive**), then **Redeploy**.

Optional: `GEMINI_MODEL` picks another model (default `gemini-flash-latest`).
On the free tier Google may use what you send to improve its products, and CVs
hold personal data; enabling billing on the key (paid tier) stops that.

**n8n workflow** (edit the prompt and model in n8n without a deploy): the workflow
"ATS - Parse CV fields" receives the CV text, runs it through Gemini, and answers
with the fields.
1. In n8n open the workflow, click the **CV from ATS** node, and create its
   **Header Auth** credential: Name `X-ATS-Secret`, Value = a long random secret.
2. Click the **Gemini** node and give it a Google Gemini credential with your
   AI Studio key (n8n's own AI credits run out quickly).
3. **Publish** the workflow and copy the node's **Production URL**.
4. In Vercel add `CV_N8N_WEBHOOK_URL` = that URL and `CV_N8N_SECRET` = the same
   secret, then **Redeploy**. Scanned PDFs without text still go to `GEMINI_API_KEY`
   directly when that is set.

**Anthropic Claude (paid)**: add `ANTHROPIC_API_KEY` instead (from
console.anthropic.com). Optional `RESUME_AI_MODEL` (default `claude-opus-5-5`).
If several are set, the n8n workflow is used first, then Gemini, then Claude.

## Video calls across networks (TURN relay)

The interview room connects people directly. On many mobile networks and home
ISPs (carrier-grade NAT) a direct connection is impossible, and the call sits on
"connecting" with no audio or video. A TURN relay fixes this by passing the media
through a server. Set up one of these, then **Redeploy**:

**Cloudflare (recommended, 1,000 GB a month free)**
1. Cloudflare dashboard → **Realtime** → **TURN Server** → **Create**.
2. Copy the **Turn Token ID** and the **API Token**.
3. In Vercel add `CLOUDFLARE_TURN_KEY_ID` (Token ID) and `CLOUDFLARE_TURN_API_TOKEN` (API Token).

**Any other provider** (Metered, Twilio, your own coturn): add `TURN_URLS`
(comma-separated, e.g. `turn:global.relay.metered.ca:80,turns:global.relay.metered.ca:443?transport=tcp`),
`TURN_USERNAME` and `TURN_CREDENTIAL`.

If a call still fails, the browser console shows a `[call] media to … failed` line
saying which connection routes were found.

## Optional: sending emails

Until this is set up, the app works fully but no emails are sent (interview invitations, reminders, status updates, password resets).

1. Create a free account at https://resend.com.
2. **Domains → Add Domain** → type your company domain (e.g. `yourcompany.com`) → Resend shows a few DNS records → add them where you bought the domain (GoDaddy, Namecheap, Cloudflare…) → wait until it says **Verified**.
3. **API Keys → Create API Key** → copy it (starts with `re_`).
4. In Vercel → Settings → Environment Variables, change or add:
   - `EMAIL_PROVIDER` = `resend`
   - `RESEND_API_KEY` = the key
   - `EMAIL_FROM` = `Acme People <careers@yourcompany.com>`, using your verified domain
5. **Redeploy.**

You can also use your company mail server instead: set `EMAIL_PROVIDER=smtp` plus `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER` and `SMTP_PASSWORD`.

---

### Sending from Gmail through n8n

The n8n workflow **"ATS - Send email via Gmail"** sends every applicant email from
the Gmail account you connect in n8n, and attaches the calendar invite to interview
emails (invitation, new time, cancellation).
1. In n8n open the workflow, click **Send with invite**, and under Credential choose
   **Create new → Sign in with Google** with the Gmail account that should send.
   Pick the same credential on **Send email**. Then **Publish** the workflow.
2. In Vercel set `EMAIL_PROVIDER` = `n8n`,
   `EMAIL_N8N_WEBHOOK_URL` = `https://<your-n8n>/webhook/ats-send-email`,
   `EMAIL_N8N_SECRET` = the value of the workflow's Header Auth credential
   (the `X-ATS-Secret` one), and `EMAIL_FROM` = `Your Company <the-gmail-address>`.
3. **Redeploy**, then schedule an interview to yourself to check it arrives with the invite.

Interview emails carry an `.ics` invite with every provider (Gmail via n8n, SMTP,
Resend) plus an "Add to Google Calendar" button; a reschedule moves the same
calendar entry and a cancellation removes it.

## Optional: bring over data from the old PHP system

This copies users (their passwords keep working), jobs, candidates, applications, interviews, notes, employees, attendance and the audit trail, plus the resume, photo and PDF files.

**Do this instead of creating your login in Step 3.** The import only works into an empty database, so in Step 3 run the setup like this:

```bash
npm run setup -- --skip-admin
```

It builds the tables and writes `vercel-env.txt` as usual, but doesn't create a login; your old accounts come over instead. Then:

1. Create a file named `.env` in the `acme-ats` folder with these lines. Copy the values from your `vercel-env.txt`:
   ```ini
   DATABASE_URL=...
   SESSION_SECRET=...
   SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
   STORAGE_DRIVER=supabase
   REALTIME_DRIVER=supabase
   APP_TIMEZONE=Asia/Manila
   ```
2. Test first. This reads everything but changes nothing:
   ```bash
   npm run db:import-mysql -- --mysql "mysql://USER:PASSWORD@HOST:3306/acme_ats" --files "C:\path\to\ATS-system-main" --dry-run
   ```
   `--files` is the old PHP folder, where the resumes and photos are.
3. If the counts look right, run the same command **without** `--dry-run`.
4. Sign in with your old account and password. Afterwards, delete the `.env` file.

If anything fails, nothing is saved, and you can fix the problem and run it again.

---

## Optional: extras

- **Reminders closer to interview time.** The free Vercel plan sends reminders once a day. For reminders about an hour before, use a free scheduler such as https://cron-job.org to call this every 15 minutes:
  - URL: `https://YOUR-SITE/api/v1/cron/interview-reminders`
  - Header: `Authorization: Bearer <your CRON_SECRET>`
- **Video calls on strict company networks.** Add a TURN server in the app under **Settings → Interview room connectivity**.
- **n8n automations.** In Vercel set `N8N_ENABLED=true` and `N8N_WEBHOOK_URL=https://your-n8n/webhook/...`. The ATS works fine without it.

---

## Try it on your computer (optional)

No accounts are needed; it uses a built-in test database with demo data.

1. In the `acme-ats` folder, create a file named `.env` containing:
   ```ini
   NODE_ENV=development
   APP_URL=http://localhost:5173
   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres
   DATABASE_POOL_MAX=1
   SESSION_SECRET=any-long-random-text-at-least-32-characters-long
   STORAGE_DRIVER=local
   REALTIME_DRIVER=local
   EMAIL_PROVIDER=log
   ```
2. Run `npm run dev` and open http://localhost:5173.
3. Sign in as `superadmin@acme.test`, `admin@acme.test`, `recruiter@acme.test`, `manager@acme.test` or `employee@acme.test`. The password for all of them is `password`.

Delete this `.env` before running the PHP import, which needs its own `.env` (see above).

---

## Troubleshooting

| What you see | What to do |
|---|---|
| `npm run setup` says it **could not reach the database** | In question 4, use the **Transaction pooler** string (port **6543**) and make sure you replaced `[YOUR-PASSWORD]` with your real database password. Forgot the password? Supabase → Project Settings → **Database** → **Reset database password**, then run setup again. |
| The website shows **"Something went wrong"** right after deploying | The settings weren't pasted, or you didn't redeploy after pasting. Do Step 4b again, then **Redeploy**. |
| Sign-in fails with **"This request came from another site"** | `APP_URL` doesn't match the address in your browser. Fix it in Vercel (exact address, no `/` at the end) → **Redeploy**. |
| Added your own domain name | Change `APP_URL` to the new address → **Redeploy**. |
| Emails don't arrive | `EMAIL_PROVIDER` is still `log`, or your domain isn't verified in Resend (see [Sending emails](#optional-sending-emails)). |
| Interview video doesn't connect | Allow the camera and microphone in the browser. On company networks, add a TURN server (see [Extras](#optional-extras)). |
| Forgot your admin password | Run `node -e "require('bcryptjs').hash('NewPassword123',12).then(console.log)"` in the folder, then in Supabase → **SQL Editor** run `update users set password_hash = 'PASTE-HASH' where email = 'you@yourcompany.com';` |

For technical details, see `README.md` and `MIGRATION_PLAN.md`.
