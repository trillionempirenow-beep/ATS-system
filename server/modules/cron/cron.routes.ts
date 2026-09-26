import { Router, type NextFunction, type Request, type Response } from 'express';
import { env } from '../../config/env.js';
import { sql } from '../../db/client.js';
import { notifyMany } from '../../core/notifications.js';
import { getSettings, intSetting } from '../../core/settings.js';
import { AppError } from '../../http/errors.js';
import { safeEqual } from '../../lib/crypto.js';
import { fullName } from '../../lib/format.js';
import { sendEmail } from '../../email/email.service.js';
import { brand, whenInfo } from '../../email/brand.js';
import { interviewReminder } from '../../email/templates/index.js';
import { candidateRoomLink } from '../interviews/interview-helpers.js';
import * as interviews from '../interviews/interviews.repository.js';
import { pruneExpiredUploads } from '../uploads/uploads.service.js';
import { pruneExpiredSessions } from '../auth/session.repository.js';

export const cronRouter = Router();

/** Vercel Cron (or n8n, or any scheduler) calls these with Authorization: Bearer CRON_SECRET. */
function requireCronSecret(req: Request, _res: Response, next: NextFunction): void {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!env.CRON_SECRET || !token || !safeEqual(token, env.CRON_SECRET)) return next(new AppError(401, 'unauthenticated', 'Invalid cron secret.'));
  next();
}

/**
 * Sends each upcoming interview one reminder, to the candidate by email and to
 * the interviewer as a notification. Safe to call as often as you like:
 * reminder_sent_at plus the email idempotency key prevent duplicates.
 * ?withinMinutes= widens the window (useful on a once-a-day schedule).
 */
async function interviewReminders(withinMinutes: number) {
  const due = await sql<{ id: number }[]>`
    select id from interviews
    where reminder_sent_at is null and status in ('scheduled','confirmed') and meeting_state in ('scheduled','ready')
      and starts_at > now() and starts_at <= now() + make_interval(mins => ${withinMinutes})
    order by starts_at limit 100`;
  const b = await brand();
  let sent = 0;
  for (const { id } of due) {
    const [claimed] = await sql<{ id: number }[]>`update interviews set reminder_sent_at = now() where id = ${id} and reminder_sent_at is null returning id`;
    if (!claimed) continue;
    const row = await interviews.byId(id);
    if (!row) continue;
    const minutes = Math.max(1, Math.round((row.starts_at.getTime() - Date.now()) / 60000));
    const startsIn = minutes < 90 ? `in ${minutes} minutes` : minutes < 36 * 60 ? `in about ${Math.round(minutes / 60)} hours` : 'soon';
    const result = await sendEmail({
      key: `interview-reminder:${id}:${row.starts_at.getTime()}`,
      template: 'interview-reminder',
      to: row.email,
      email: interviewReminder(b, { candidateName: row.first_name, jobTitle: row.job_title, when: whenInfo(row.starts_at), joinUrl: row.room_code ? candidateRoomLink(row) : row.meeting_url, startsIn }),
    });
    if (row.interviewer_id) {
      await notifyMany([row.interviewer_id], {
        type: 'interview_reminder', title: `Interview starts ${startsIn}`,
        body: `${fullName(row.first_name, row.last_name)} · ${row.job_title}.`, link: row.room_code ? `/app/interviews/${id}/room` : '/app/interviews',
        actionLabel: row.room_code ? 'Open room' : 'Open interviews', entityType: 'interview', entityId: id,
      });
    }
    if (result.outcome === 'sent' || result.outcome === 'skipped') sent++;
  }
  return { due: due.length, sent };
}

cronRouter.all('/cron/interview-reminders', requireCronSecret, async (req, res) => {
  const s = await getSettings();
  const requested = Number(req.query.withinMinutes);
  const window = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 2880) : intSetting(s.interview_reminder_minutes, 60, 5);
  const reminders = await interviewReminders(window);
  const housekeeping = {
    uploadsPruned: await pruneExpiredUploads(),
    orphanDocumentsPruned: (await sql`delete from candidate_documents where candidate_id is null and created_at < now() - interval '1 day'`).count,
    rateLimitsPruned: (await sql`delete from rate_limits where window_start < now() - interval '1 day'`).count,
  };
  await pruneExpiredSessions();
  res.json({ data: { reminders, housekeeping } });
});
