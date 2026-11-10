# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Applicants (primary for design trade-offs):** people outside the company who find open roles on the careers site, apply (often on a phone), check their application status, withdraw, or refer someone. Most visit only once or twice, so the site has to earn their trust and be clear right away. When a choice affects applicants differently from staff, applicants come first.
- **HR / Recruiters:** daily users of the pipeline, candidate profiles, interview scheduling and reviews.
- **Hiring Managers and interviewers:** occasional users who review candidates, join the interview room, and fill in scorecards.
- **Admins and Super Admins:** manage company details, hiring defaults, accounts and seats, password-reset approvals and the audit trail.
- **Employees:** see their own records and attendance, and can refer people.
- **Outside stakeholders:** join final interviews through a guest link (give name and position, then a host admits them).

## Product Purpose

An applicant tracking system run in-house by one company to manage its hiring end to end: posting jobs, taking applications with CV parsing, moving candidates through a staged pipeline, running interviews in a built-in video room, and converting hired candidates into employees. It is a rebuild of an earlier PHP app and keeps that app's data and workflows. Success means applicants can apply and follow their status without friction, and the hiring team makes decisions from one place using real data.

## Positioning

Everything happens in one tool owned by the company: careers site, pipeline, the built-in interview room (waiting room, admit, video, screen share, chat, live notes, private scorecard, recordings with summaries and flagged moments), approvals and people records. The hiring workflow does not need a separate video tool or HR system.

## Operating Context

- Recruiters work in the pipeline (drag and drop with stage rules) and on candidate profiles throughout the day.
- Interviews run in the built-in room as small mesh calls (up to about four people), or through an external link.
- Job postings go through an approval workflow and can be imported from a PDF.
- Email notifications come from an outbox. Reminders run on a cron schedule. Optional n8n webhooks send events to other systems.
- Every user sets their own theme (light, dark or match system), density, start page, time format and reduced motion.

## Capabilities and Constraints

- Roles: Super Admin, Admin, HR / Recruiter, Hiring Manager, Employee, plus public applicants and interview guests.
- Light and dark themes, plus density and reduced-motion preferences, are already features users rely on.
- **Multiple languages are required.** The UI must be ready to translate: text strings, plus layouts that cope with longer translated text and with how dates, times and numbers are written in different locales. Which languages, and whether right-to-left scripts are in scope, is undecided.
- Applicants and staff both make heavy use of phones. Phone layouts are required for real tasks, not as an afterthought.
- Acme Assist (AI notes during interviews) needs a transcription provider, and none is configured yet. The interview room has to say so honestly.
- Payroll and leave are out of scope.

## Brand Commitments

- "Acme" / "Acme People" is a **placeholder name**. The real company brand will come later, so names, logos and brand colours must be easy to swap. Do not build anything that depends on the word "Acme".
- Existing placeholder assets: `public/logo.webp`, `public/logo-light.webp`, `public/logo-192.png`, `public/logo-512.png`, `public/logo-email.png`, favicons, and the Acme Assist mascot (`public/acme-assistant-*.webp|webm`). None of these is a final brand asset.

## Evidence on Hand

- Demo data lives in `supabase/seed.sql`. Sample files are in `samples/`, and an early design mockup is in `mockup/`.
- There are no real testimonials, customer stories, employer-brand content or hiring statistics. Do not invent any for the careers site.

## Product Principles

1. **Applicants first.** When staff convenience and applicant clarity conflict, the applicant experience wins. A first-time visitor on a phone must be able to find a role, apply and follow up without help.
2. **Accessible and translatable by default.** Every screen meets WCAG 2.2 AA and can be translated. Neither is added later.
3. **One place for the hiring decision.** Candidate data, interview evidence and reviews stay together, so decisions rest on what actually happened.
4. **Honest about limits.** If a feature is unavailable (for example, no transcription provider), the UI says so plainly and never fakes it.
5. **Brand-neutral underneath.** The company identity is a swappable layer, because the real brand has not arrived yet.

## Accessibility & Inclusion

- WCAG 2.2 AA is a firm requirement, on both the public careers site and the internal app.
- Honour the user's reduced-motion, theme and density preferences everywhere.
- Support multiple languages: keep layouts robust to longer text and format dates, times and numbers for the user's locale.
