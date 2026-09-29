import type { z } from 'zod';
import { APPLY_SOURCES, STAGE_LABELS, STAGE_ORDER, sourceLabel, stageRank } from '../../../shared/domain/pipeline.js';
import { jobTags, spotsRemaining, splitLines } from '../../../shared/domain/jobs.js';
import { candidateJoinState, interviewDisplayState } from '../../../shared/domain/interviews.js';
import { dialCodeFor } from '../../../shared/domain/phone.js';
import type {
  ApplicationStatusDto, ApplyResultDto, CandidateInterviewDto, PublicConfigDto, PublicHomeDto, PublicJobCardDto,
  PublicJobDetailDto, PublicJobsDto, StatusLookupDto, applySchema, publicJobsQuerySchema, referralSchema,
} from '../../../shared/api/public.js';
import { sql, transaction } from '../../db/client.js';
import { audit } from '../../core/audit.js';
import { notifyMany } from '../../core/notifications.js';
import { getSettings, interviewTiming } from '../../core/settings.js';
import { AppError, conflict, isUniqueViolation, notFound } from '../../http/errors.js';
import { formatTime, iso, isoOrThrow } from '../../lib/format.js';
import { sendEmail } from '../../email/email.service.js';
import { appLink, brand } from '../../email/brand.js';
import { applicationReceived } from '../../email/templates/index.js';
import { emitN8nEvent } from '../../integrations/n8n/n8n.client.js';
import { extractDocumentText } from '../../parsers/text-extract.js';
import { consumeUpload, type ConsumedUpload } from '../uploads/uploads.service.js';
import { BUCKETS, storage } from '../../storage/storage.js';
import * as repo from './public.repository.js';

export async function publicConfig(): Promise<PublicConfigDto> {
  const s = await getSettings();
  const b = await brand();
  return {
    companyName: b.company,
    careersHeadline: s.careers_headline || 'Do the best work of your career.',
    logoUrl: b.logoUrl,
    acceptingApplications: s.portal_accepting_applications !== '0',
    closedMessage: s.portal_closed_message || 'We are not accepting applications at the moment. Please check back soon.',
  };
}

function toCard(j: repo.PublicJobRow): PublicJobCardDto {
  const remaining = spotsRemaining(j.applicant_limit, j.applications);
  return {
    id: j.id,
    slug: j.slug,
    title: j.title,
    department: j.department,
    location: j.location,
    employmentType: j.employment_type,
    tags: jobTags(j.tags),
    isUrgent: j.is_urgent,
    applications: j.applications,
    applicantLimit: j.applicant_limit,
    spotsRemaining: remaining,
    full: remaining === 0,
    postedAt: isoOrThrow(j.published_at ?? j.created_at),
  };
}

export async function home(): Promise<PublicHomeDto> {
  const jobs = await repo.openJobs();
  const cards = jobs.map(toCard);
  return {
    urgent: cards.filter((c) => c.isUrgent),
    featured: cards.slice(0, 6),
    stats: {
      openRoles: cards.length,
      departmentsHiring: new Set(cards.map((c) => c.department).filter(Boolean)).size,
      remoteRoles: cards.filter((c) => /remote/i.test(c.location ?? '')).length,
    },
  };
}

export async function listJobs(q: z.infer<typeof publicJobsQuerySchema>): Promise<PublicJobsDto> {
  const all = (await repo.openJobs()).map(toCard);
  const needle = q.q?.toLowerCase();
  const jobs = all.filter((j) => {
    if (q.dept && j.department !== q.dept) return false;
    if (q.loc && !(j.location ?? '').toLowerCase().includes(q.loc.toLowerCase())) return false;
    if (q.tag && !j.tags.some((t) => t.toLowerCase() === q.tag!.toLowerCase())) return false;
    if (q.urgent && !j.isUrgent) return false;
    if (needle) {
      const hay = `${j.title} ${j.department ?? ''} ${j.location ?? ''} ${j.tags.join(' ')}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const uniq = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => Boolean(x)))].sort();
  return {
    jobs,
    total: all.length,
    facets: {
      departments: uniq(all.map((j) => j.department)),
      locations: uniq(all.map((j) => j.location)),
      tags: uniq(all.flatMap((j) => j.tags)),
    },
  };
}

export async function jobDetail(slug: string): Promise<PublicJobDetailDto> {
  const job = await repo.openJobBySlug(slug);
  if (!job) throw notFound('This position may have closed or moved.');
  const cfg = await publicConfig();
  const card = toCard(job);
  const related = (await repo.openJobs()).filter((j) => j.id !== job.id).slice(0, 3).map(toCard);
  const closedReason = !cfg.acceptingApplications
    ? cfg.closedMessage
    : card.full ? 'This role has reached its applicant limit and is no longer accepting applications.' : null;
  return {
    ...card,
    description: job.description,
    responsibilities: splitLines(job.responsibilities),
    requirements: splitLines(job.requirements),
    qualifications: splitLines(job.qualifications),
    preferredSkills: splitLines(job.preferred_skills),
    experienceRequired: job.experience_required,
    educationRequired: job.education_required,
    salaryInfo: job.salary_info,
    related,
    acceptingApplications: closedReason === null,
    closedReason,
  };
}

export async function apply(slug: string, input: z.infer<typeof applySchema>, ip: string | null): Promise<ApplyResultDto> {
  const job = await repo.openJobBySlug(slug);
  if (!job) throw notFound('This job is no longer accepting applications.');
  const cfg = await publicConfig();
  if (!cfg.acceptingApplications) throw new AppError(409, 'applicant_limit_reached', cfg.closedMessage);
  if (spotsRemaining(job.applicant_limit, job.applications) === 0) {
    throw new AppError(409, 'applicant_limit_reached', 'This role has reached its applicant limit and is no longer accepting applications.');
  }

  const resume = await consumeUpload(input.resumeUploadId, 'resume', null, 'documents', 'resume');
  let photo: ConsumedUpload | null = null;
  try {
    if (input.photoUploadId) photo = await consumeUpload(input.photoUploadId, 'candidate_photo', null, 'candidates', 'photo');
  } catch (e) {
    await storage.remove(resume.bucket, [resume.path]);
    throw e;
  }

  const [first, ...rest] = input.name.split(/\s+/);
  const last = rest.join(' ');
  const phone = input.phoneNumber ? `+${dialCodeFor(input.phoneCountry)} ${input.phoneNumber}` : null;
  const source = input.source === 'other' ? `Other: ${input.sourceOther}`.slice(0, 80) : input.source;

  let applicationId: number;
  let candidateId: number;
  try {
    ({ applicationId, candidateId } = await transaction(async (tx) => {
      const lock = await repo.lockJobForApply(tx, job.id);
      if (!lock) throw notFound('This job is no longer accepting applications.');
      if (lock.applicant_limit !== null && lock.applications >= lock.applicant_limit) {
        throw new AppError(409, 'applicant_limit_reached', 'This role just reached its applicant limit. Please explore other open roles.');
      }
      const [existing] = await tx<{ id: number }[]>`select id from candidates where email = ${input.email} order by id desc limit 1`;
      let cid: number;
      if (existing) {
        cid = existing.id;
        await tx`update candidates set first_name = ${first ?? input.name}, last_name = ${last}, phone = ${phone},
                   portfolio_url = ${input.portfolio || null}, source = ${source},
                   profile_image = coalesce(${photo?.path ?? null}, profile_image), consent_at = now(), record_status = 'active'
                 where id = ${cid}`;
      } else {
        const [c] = await tx<{ id: number }[]>`
          insert into candidates (first_name, last_name, email, phone, portfolio_url, source, profile_image, consent_at)
          values (${first ?? input.name}, ${last}, ${input.email}, ${phone}, ${input.portfolio || null}, ${source}, ${photo?.path ?? null}, now())
          returning id`;
        cid = c!.id;
      }
      const [a] = await tx<{ id: number }[]>`
        insert into applications (candidate_id, job_id, cover_letter, why_us) values (${cid}, ${job.id}, ${input.coverLetter}, ${input.whyUs})
        returning id`;
      await tx`update candidate_documents set is_primary = false where candidate_id = ${cid}`;
      await tx`insert into candidate_documents (candidate_id, storage_path, original_name, extension, mime_type, byte_size, is_primary)
               values (${cid}, ${resume.path}, ${resume.originalName}, ${resume.extension}, ${resume.mime}, ${resume.size}, true)`;
      await audit({ userId: null, action: 'application_submitted', entityType: 'application', entityId: a!.id,
        details: { job: job.title, source: APPLY_SOURCES[input.source] ?? source }, ip }, tx);
      return { applicationId: a!.id, candidateId: cid };
    }));
  } catch (e) {
    await storage.remove(BUCKETS.resumes, [resume.path]).catch(() => undefined);
    if (photo) await storage.remove(BUCKETS.photos, [photo.path]).catch(() => undefined);
    if (isUniqueViolation(e)) throw conflict('You already have an application for this role.');
    throw e;
  }

  // Keep the resume searchable. Best effort: a parse failure never affects the application.
  try {
    const parsed = await extractDocumentText(resume.data, resume.extension);
    if (!parsed.error && parsed.text) {
      await sql`update candidates set resume_text = ${parsed.text.slice(0, 60000)} where id = ${candidateId}`;
      await sql`update candidate_documents set parsed = true where storage_path = ${resume.path}`;
    }
  } catch (e) {
    console.warn('[apply] resume text extraction failed', e);
  }

  const b = await brand();
  const emailResult = await sendEmail({
    key: `application-received:${applicationId}`,
    template: 'application-received',
    to: input.email,
    email: applicationReceived(b, {
      candidateName: first ?? input.name,
      jobTitle: job.title,
      applicationId,
      statusUrl: appLink(`/status?email=${encodeURIComponent(input.email)}&id=${applicationId}`),
    }),
  });

  const followers = [job.created_by, job.owner_id].filter((x): x is number => x !== null);
  await notifyMany(followers, {
    type: 'application_received',
    title: 'New application',
    body: `${input.name} applied for ${job.title}.`,
    link: `/app/candidates/${applicationId}`,
    actionLabel: 'Open candidate',
    entityType: 'application',
    entityId: applicationId,
  });

  emitN8nEvent('application.submitted', {
    applicationId, candidateId, jobId: job.id, jobTitle: job.title, candidateName: input.name, candidateEmail: input.email,
    source, emailSentByApp: emailResult.outcome === 'sent',
  });

  return { applicationId, email: input.email, jobTitle: job.title, confirmationEmail: emailResult.outcome };
}

async function candidateInterviews(applicationId: number): Promise<CandidateInterviewDto[]> {
  const rows = await repo.upcomingInterviewsFor(applicationId);
  const timing = await interviewTiming();
  return rows.map((iv) => {
    const startsAt = isoOrThrow(iv.starts_at);
    const timingRow = { status: iv.status, meeting_state: iv.meeting_state, starts_at: startsAt };
    let room: CandidateInterviewDto['room'] = null;
    if (iv.room_code && iv.candidate_token) {
      const js = candidateJoinState(
        { ...timingRow, candidate_request_state: iv.candidate_request_state, interviewer_last_seen: iso(iv.interviewer_last_seen) },
        { ...timing, formatTime: (t) => formatTime(t) },
      );
      room = {
        url: `/interview/${encodeURIComponent(iv.room_code)}?t=${iv.candidate_token}`,
        joinState: js.state,
        canJoin: js.canJoin,
        message: js.message,
        roomCode: iv.room_code,
      };
    }
    return {
      id: iv.id,
      meetingType: iv.meeting_type,
      interviewType: iv.interview_type,
      startsAt,
      endsAt: iso(iv.ends_at),
      interviewerName: iv.interviewer_name,
      state: interviewDisplayState(timingRow),
      location: iv.location,
      externalUrl: iv.room_code ? null : iv.meeting_url,
      room,
    };
  });
}

const STAGE_EVENT: Record<string, [string, string | null]> = {
  new: ['Back to applied', null],
  screening: ['Screening started', 'A recruiter is reviewing your application'],
  interview: ['Interview stage', 'You are moving on to interviews'],
  offer: ['Offer stage', 'The team is preparing an offer'],
  hired: ['Hired', 'Welcome to the team'],
  rejected: ['Application closed', null],
};

async function statusEvents(applicationId: number, appliedAt: Date) {
  const rows = await repo.applicationEvents(applicationId);
  const events = rows.map((r) => {
    if (r.action === 'application_withdrawn') return { key: `e${r.id}`, title: 'Application withdrawn', note: null, at: isoOrThrow(r.created_at) };
    if (r.action === 'interview_create') return { key: `e${r.id}`, title: 'Interview scheduled', note: null, at: isoOrThrow(r.created_at) };
    const [title, note] = STAGE_EVENT[String(r.details?.to ?? '')] ?? ['Application updated', null];
    return { key: `e${r.id}`, title, note, at: isoOrThrow(r.created_at) };
  });
  events.push({ key: 'received', title: 'Application received', note: null, at: isoOrThrow(appliedAt) });
  return events;
}

export async function statusLookup(email: string, applicationId?: number): Promise<StatusLookupDto> {
  if (!applicationId) {
    const rows = await repo.applicationsForEmail(email);
    if (!rows.length) throw notFound('We could not find any applications under that email.');
    return {
      kind: 'list',
      applications: rows.map((r) => ({
        id: r.id, stage: r.stage, stageLabel: STAGE_LABELS[r.stage], jobTitle: r.title, appliedAt: isoOrThrow(r.applied_at), withdrawn: r.status === 'withdrawn',
      })),
    };
  }
  const row = await repo.applicationForEmail(applicationId, email);
  if (!row) throw notFound('We could not find an application matching that ID and email.');
  const current = stageRank(row.stage);
  const rejected = row.stage === 'rejected';
  const [feedback, suggestions, resumeName] = await Promise.all([
    rejected ? repo.latestFeedback(row.id) : null,
    row.stage === 'hired' ? [] : repo.suggestionsFor(row.id, row.candidate_id),
    repo.primaryResumeName(row.candidate_id),
  ]);
  const application: ApplicationStatusDto = {
    id: row.id,
    stage: row.stage,
    stageLabel: STAGE_LABELS[row.stage],
    withdrawn: row.status === 'withdrawn',
    rejected,
    jobTitle: row.title,
    jobDepartment: row.department,
    jobLocation: row.location,
    firstName: row.first_name,
    lastName: row.last_name,
    appliedAt: isoOrThrow(row.applied_at),
    updatedAt: isoOrThrow(row.updated_at),
    timeline: STAGE_ORDER.map((key) => ({ key, label: STAGE_LABELS[key], reached: stageRank(key) <= current, current: key === row.stage })),
    feedback,
    suggestions: suggestions.map((sg) => ({ title: sg.title, slug: sg.status === 'open' ? sg.slug : null, note: sg.note, alreadyApplied: sg.already_applied })),
    submission: {
      coverLetter: row.cover_letter,
      whyUs: row.why_us,
      portfolio: row.portfolio_url,
      source: row.source ? sourceLabel(row.source) : null,
      resumeName,
    },
    interviews: row.status === 'withdrawn' || rejected ? [] : await candidateInterviews(row.id),
    events: await statusEvents(row.id, row.applied_at),
  };
  return { kind: 'application', application };
}

export async function withdraw(email: string, applicationId: number, ip: string | null): Promise<void> {
  const row = await repo.applicationForEmail(applicationId, email);
  if (!row) throw notFound('We could not find an application matching that ID and email.');
  if (row.status === 'withdrawn') return;
  await transaction(async (tx) => {
    await tx`update applications set status = 'withdrawn', updated_at = now() where id = ${applicationId}`;
    await audit({ userId: null, action: 'application_withdrawn', entityType: 'application', entityId: applicationId, details: { previous_stage: row.stage }, ip }, tx);
  });
  emitN8nEvent('application.withdrawn', { applicationId, previousStage: row.stage });
}

export async function createReferral(input: z.infer<typeof referralSchema>, ip: string | null): Promise<void> {
  const [r] = await sql<{ id: number }[]>`
    insert into referrals (referrer_name, referrer_email, candidate_name, candidate_email, job_id, notes)
    values (${input.referrerName}, ${input.referrerEmail}, ${input.candidateName}, ${input.candidateEmail}, ${input.jobId ?? null}, ${input.note || null})
    returning id`;
  await audit({ userId: null, action: 'referral_create', entityType: 'referral', entityId: r!.id, ip });
  emitN8nEvent('referral.created', { referralId: r!.id, jobId: input.jobId ?? null });
}

