import type { z } from 'zod';
import { SKIP_BLOCKED_MESSAGE, STAGE_LABELS, STAGE_ORDER, isStageSkip, type BoardStage, type Stage } from '../../../shared/domain/pipeline.js';
import type { PipelineCardDto, PipelineDto, StageMoveResultDto, pipelineQuerySchema, stageMoveSchema } from '../../../shared/api/pipeline.js';
import { sql, transaction } from '../../db/client.js';
import { audit } from '../../core/audit.js';
import { notifyMany } from '../../core/notifications.js';
import type { CurrentUser } from '../../http/context.js';
import { AppError, notFound } from '../../http/errors.js';
import { fullName, isoOrThrow } from '../../lib/format.js';
import { sendEmail, toDeliveryReport } from '../../email/email.service.js';
import { appLink, brand } from '../../email/brand.js';
import { applicationStatus } from '../../email/templates/index.js';
import { emitN8nEvent } from '../../integrations/n8n/n8n.client.js';
import { avatarUrlForCandidate } from '../media/media.urls.js';

interface CardRow {
  id: number; stage: Stage; applied_at: Date; updated_at: Date; candidate_id: number; first_name: string; last_name: string; email: string;
  resume_path: string | null; profile_image: string | null; rating: number; title: string; overall_score: number | null;
  primary_doc_id: number | null; note_count: number; latest_note: string | null; screening_score: number | null; interview_score: number | null;
}

export async function board(q: z.infer<typeof pipelineQuerySchema>): Promise<PipelineDto> {
  const like = q.q ? `%${q.q}%` : null;
  const rows = await sql<CardRow[]>`
    select a.id, a.stage, a.applied_at, a.updated_at, c.id as candidate_id, c.first_name, c.last_name, c.email::text, c.resume_path,
           c.profile_image, c.rating, j.title, ai.overall_score,
           (select d.id from candidate_documents d where d.candidate_id = c.id and d.is_primary order by d.created_at desc limit 1) as primary_doc_id,
           (select count(*)::int from candidate_notes n where n.candidate_id = c.id) as note_count,
           (select n.note from candidate_notes n where n.candidate_id = c.id order by n.created_at desc limit 1) as latest_note,
           (select rating from stage_reviews sr where sr.application_id = a.id and sr.stage_type = 'screening') as screening_score,
           (select rating from stage_reviews sr where sr.application_id = a.id and sr.stage_type = 'interview') as interview_score
    from applications a join candidates c on c.id = a.candidate_id join jobs j on j.id = a.job_id
    left join candidate_ai_analysis ai on ai.application_id = a.id
    where a.status = 'active' and a.stage <> 'rejected'
      ${q.job ? sql`and j.id = ${q.job}` : sql``}
      ${q.dept ? sql`and j.department_id = ${q.dept}` : sql``}
      ${like ? sql`and (c.first_name ilike ${like} or c.last_name ilike ${like} or (c.first_name || ' ' || c.last_name) ilike ${like} or j.title ilike ${like})` : sql``}
    order by a.updated_at desc`;
  const columns = Object.fromEntries(STAGE_ORDER.map((s) => [s, [] as PipelineCardDto[]])) as Record<BoardStage, PipelineCardDto[]>;
  for (const r of rows) {
    if (r.stage === 'rejected') continue;
    columns[r.stage].push({
      applicationId: r.id, candidateId: r.candidate_id, name: fullName(r.first_name, r.last_name), email: r.email,
      avatarUrl: avatarUrlForCandidate(r.candidate_id, r.profile_image), jobTitle: r.title, stage: r.stage,
      appliedAt: isoOrThrow(r.applied_at), updatedAt: isoOrThrow(r.updated_at), aiScore: r.overall_score, rating: r.rating,
      noteCount: r.note_count, latestNote: r.latest_note, screeningScore: r.screening_score, interviewScore: r.interview_score,
      primaryDocumentId: r.primary_doc_id, hasResume: Boolean(r.primary_doc_id || r.resume_path),
    });
  }
  const [jobs, departments] = await Promise.all([
    sql<{ id: number; title: string }[]>`select id, title from jobs where status in ('open','paused') order by title`,
    sql<{ id: number; name: string }[]>`select id, name from departments order by name`,
  ]);
  return { columns, jobs, departments };
}

/**
 * PipelineService.moveStage — one rule for the board, the profile and drag and
 * drop: forward one step, backward and reject are always allowed; skipping
 * forward needs an Admin who asks for the override.
 */
export async function moveStage(applicationId: number, input: z.infer<typeof stageMoveSchema>, user: CurrentUser, ip: string | null): Promise<StageMoveResultDto> {
  // Only the Admin role may skip stages, exactly as pipeline.php enforced it.
  const override = input.override && user.role === 'admin';
  const moved = await transaction(async (tx) => {
    const [app] = await tx<{ stage: Stage; status: string; assigned_to: number | null; candidate_id: number; first_name: string; last_name: string; email: string; title: string }[]>`
      select a.stage, a.status, a.assigned_to, c.id as candidate_id, c.first_name, c.last_name, c.email::text, j.title
      from applications a join candidates c on c.id = a.candidate_id join jobs j on j.id = a.job_id
      where a.id = ${applicationId} for update of a`;
    if (!app) throw notFound('Candidate not found.');
    if (app.status === 'withdrawn') throw new AppError(409, 'conflict', 'This application was withdrawn by the applicant.');
    const skip = isStageSkip(app.stage, input.stage);
    if (skip && !override) {
      throw new AppError(409, 'skip_blocked', SKIP_BLOCKED_MESSAGE, undefined, { canOverride: user.role === 'admin' });
    }
    if (app.stage !== input.stage) {
      await tx`update applications set stage = ${input.stage}, updated_at = now() where id = ${applicationId}`;
      await audit({ userId: user.id, action: 'pipeline_stage_move', entityType: 'application', entityId: applicationId,
        details: { from: app.stage, to: input.stage, override: skip && override }, ip }, tx);
    }
    return { ...app, from: app.stage, skip };
  });

  const result: StageMoveResultDto = { from: moved.from, to: input.stage, override: moved.skip && override };
  if (moved.from === input.stage) return result;

  if (moved.assigned_to) {
    await notifyMany([moved.assigned_to], {
      actorId: user.id, type: 'stage_moved', title: 'Candidate moved',
      body: `${user.name} moved ${fullName(moved.first_name, moved.last_name)} from ${STAGE_LABELS[moved.from]} to ${STAGE_LABELS[input.stage]}.`,
      link: `/app/candidates/${applicationId}`, actionLabel: 'Open candidate', entityType: 'application', entityId: applicationId,
    });
  }

  let emailSent = false;
  if (input.notifyApplicant && input.stage !== 'new') {
    const [fb] = input.stage === 'rejected'
      ? await sql<{ notes: string | null }[]>`select notes from candidate_feedback where application_id = ${applicationId} order by created_at desc limit 1`
      : [];
    const b = await brand();
    const email = await sendEmail({
      key: `application-status:${applicationId}:${input.stage}`,
      template: 'application-status',
      to: moved.email,
      email: applicationStatus(b, {
        candidateName: moved.first_name, jobTitle: moved.title, stage: input.stage, stageLabel: STAGE_LABELS[input.stage],
        statusUrl: appLink(`/status?email=${encodeURIComponent(moved.email)}&id=${applicationId}`), feedback: fb?.notes ?? null,
      }),
    });
    emailSent = email.outcome === 'sent';
    Object.assign(result, toDeliveryReport(email));
  }
  emitN8nEvent('application.stage_changed', { applicationId, from: moved.from, to: input.stage, override: result.override, actorId: user.id, emailSentByApp: emailSent });
  return result;
}
