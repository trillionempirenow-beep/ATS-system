import { randomInt } from 'node:crypto';
import type { z } from 'zod';
import {
  LIBRARY_SECTIONS, type CreateShareResultDto, type LibraryDetailDto, type LibraryFileDto, type LibraryInterviewDto, type LibraryListDto,
  type LibrarySection, type LibraryShareDto, type ShareStatus, type SharedFileDto, type SharedLandingDto, type ShareViewerDto,
  type createShareSchema, type libraryListQuerySchema,
} from '../../../shared/api/library.js';
import type { AiSummary } from '../../../shared/api/interviews.js';
import { EXPERIENCE_LEVEL_LABELS, REVIEW_STAGE_LABELS, STAGES, type ReviewStage, type Stage } from '../../../shared/domain/pipeline.js';
import { interviewDisplayState } from '../../../shared/domain/interviews.js';
import { sql } from '../../db/client.js';
import { audit, auditQuietly } from '../../core/audit.js';
import type { CurrentUser } from '../../http/context.js';
import { AppError, notFound } from '../../http/errors.js';
import { fullName, iso, isoOrThrow } from '../../lib/format.js';
import { randomToken, safeEqual, sha256 } from '../../lib/crypto.js';
import { appLink, brand } from '../../email/brand.js';
import { sendEmail } from '../../email/email.service.js';
import { libraryShareCode, libraryShareInvite } from '../../email/templates/index.js';
import { BUCKETS, storage } from '../../storage/storage.js';
import * as candidates from '../candidates/candidates.service.js';

/**
 * The Library: every applicant's file in one place, and view-only copies of a
 * file shared by email with someone outside the system. A recipient proves they
 * own the address with a one-time code; staff can turn a share off at any time.
 */

type Ctx = { user: CurrentUser; ip: string | null };

const PAGE_SIZE = 25;
const CODE_TTL_MS = 10 * 60_000;
const CODE_MAX_TRIES = 5;
const VIEWER_TTL_MS = 8 * 60 * 60_000;

// ---------------------------------------------------------------------------
// Staff: the list and one applicant's file
// ---------------------------------------------------------------------------

export async function list(q: z.infer<typeof libraryListQuerySchema>): Promise<LibraryListDto> {
  const needle = q.q ? `%${q.q.toLowerCase()}%` : null;
  const stage = q.stage && (STAGES as readonly string[]).includes(q.stage) ? q.stage : null;
  const where = sql`
    where (${needle}::text is null or lower(c.first_name || ' ' || coalesce(c.last_name, '') || ' ' || c.email::text || ' ' || j.title) like ${needle})
      and (${q.job ?? null}::bigint is null or a.job_id = ${q.job ?? null})
      and (${stage}::text is null or a.stage = ${stage})
      and (${q.has ?? null}::text is null
        or (${q.has ?? null} = 'recording' and exists (select 1 from interview_recordings r join interviews i on i.id = r.interview_id where i.application_id = a.id))
        or (${q.has ?? null} = 'summary' and exists (select 1 from interviews i where i.application_id = a.id and i.ai_summary is not null))
        or (${q.has ?? null} = 'shared' and exists (select 1 from library_shares s where s.application_id = a.id and s.revoked_at is null and (s.expires_at is null or s.expires_at > now()))))`;
  const [rows, [count], jobs] = await Promise.all([
    sql<Array<{ application_id: number; first_name: string; last_name: string | null; email: string; job_title: string; stage: Stage; status: string; applied_at: Date;
      documents: number; interviews: number; summaries: number; recordings: number; active_shares: number }>>`
      select a.id as application_id, c.first_name, c.last_name, c.email::text as email, j.title as job_title, a.stage, a.status, a.applied_at,
             (select count(*)::int from candidate_documents d where d.candidate_id = c.id) as documents,
             (select count(*)::int from interviews i where i.application_id = a.id and i.status <> 'cancelled') as interviews,
             (select count(*)::int from interviews i where i.application_id = a.id and i.ai_summary is not null) as summaries,
             (select count(*)::int from interview_recordings r join interviews i on i.id = r.interview_id where i.application_id = a.id) as recordings,
             (select count(*)::int from library_shares s where s.application_id = a.id and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())) as active_shares
      from applications a join candidates c on c.id = a.candidate_id join jobs j on j.id = a.job_id
      ${where}
      order by a.applied_at desc, a.id desc
      limit ${PAGE_SIZE} offset ${(q.page - 1) * PAGE_SIZE}`,
    sql<{ n: number }[]>`select count(*)::int as n from applications a join candidates c on c.id = a.candidate_id join jobs j on j.id = a.job_id ${where}`,
    sql<{ id: number; title: string }[]>`select distinct j.id, j.title from jobs j join applications a on a.job_id = j.id order by j.title`,
  ]);
  return {
    rows: rows.map((r) => ({
      applicationId: r.application_id, name: fullName(r.first_name, r.last_name), email: r.email, jobTitle: r.job_title, stage: r.stage,
      withdrawn: r.status === 'withdrawn', appliedAt: isoOrThrow(r.applied_at), documents: r.documents, interviews: r.interviews,
      summaries: r.summaries, recordings: r.recordings, activeShares: r.active_shares,
    })),
    total: count?.n ?? 0,
    page: q.page,
    pageSize: PAGE_SIZE,
    jobs,
  };
}

const parseSummary = (v: unknown): AiSummary | null => {
  if (!v) return null;
  if (typeof v === 'string') { try { return JSON.parse(v) as AiSummary; } catch { return null; } }
  return v as AiSummary;
};

/** The whole file, then cut down to the sections a share includes. */
async function buildFile(applicationId: number, sections: readonly LibrarySection[]): Promise<LibraryFileDto> {
  const p = await candidates.profile(applicationId);
  const has = (s: LibrarySection) => sections.includes(s);

  let interviews: LibraryInterviewDto[] = [];
  if (has('interviews') || has('transcripts') || has('recordings')) {
    const rows = await sql<Array<{ id: number; meeting_type: string; is_final: boolean; starts_at: Date; status: string; meeting_state: string; interviewer: string | null;
      score: number | null; recommendation: string | null; feedback: string | null; ai_summary: unknown }>>`
      select i.id, i.meeting_type, i.is_final, i.starts_at, i.status, i.meeting_state, u.name as interviewer, i.score, i.recommendation, i.feedback, i.ai_summary
      from interviews i left join users u on u.id = i.interviewer_id
      where i.application_id = ${applicationId} and i.status <> 'cancelled' order by i.starts_at`;
    const ids = rows.map((r) => r.id);
    const [lines, recs] = ids.length ? await Promise.all([
      has('transcripts') ? sql<{ interview_id: number; at_second: number; text: string }[]>`
        select interview_id, at_second, text from interview_transcripts where interview_id in ${sql(ids)} order by interview_id, at_second` : Promise.resolve([]),
      has('recordings') ? sql<{ id: number; interview_id: number; seq: number; duration_sec: number; size_bytes: number; started_at: Date }[]>`
        select id, interview_id, seq, duration_sec, size_bytes, started_at from interview_recordings where interview_id in ${sql(ids)} order by interview_id, seq` : Promise.resolve([]),
    ]) : [[], []];
    interviews = rows.map((r) => ({
      id: r.id,
      kind: r.meeting_type === 'screening' ? 'Screening' : r.is_final ? 'Final interview' : 'Interview',
      startsAt: isoOrThrow(r.starts_at),
      interviewerName: r.interviewer,
      state: interviewDisplayState({ status: r.status as never, meeting_state: r.meeting_state as never, starts_at: isoOrThrow(r.starts_at) }),
      score: has('interviews') ? r.score : null,
      recommendation: has('interviews') ? r.recommendation : null,
      feedback: has('interviews') ? r.feedback : null,
      aiSummary: has('interviews') ? parseSummary(r.ai_summary) : null,
      transcript: lines.filter((l) => l.interview_id === r.id).map((l) => ({ atSecond: l.at_second, text: l.text })),
      recordings: recs.filter((x) => x.interview_id === r.id).map((x) => ({ id: x.id, seq: x.seq, durationSec: x.duration_sec, sizeBytes: Number(x.size_bytes), startedAt: isoOrThrow(x.started_at) })),
    }));
  }

  const reviews = ([['screening', p.screeningReview], ['interview', p.interviewReview], ['final_interview', p.finalInterviewReview]] as const)
    .filter(([, r]) => r)
    .map(([t, r]) => ({ ...r!, label: REVIEW_STAGE_LABELS[t as ReviewStage] }));

  return {
    applicationId: p.applicationId,
    sections: [...sections],
    name: p.name,
    jobTitle: p.job.title,
    department: p.job.department,
    stage: p.stage,
    withdrawn: p.applicationStatus === 'withdrawn',
    appliedAt: p.appliedAt,
    details: has('details') ? {
      email: p.email, phone: p.phone, currentTitle: p.currentTitle,
      experience: p.experienceLevel ? EXPERIENCE_LEVEL_LABELS[p.experienceLevel] : null,
      skills: (p.skills ?? '').split(',').map((x) => x.trim()).filter(Boolean),
      education: p.education, portfolioUrl: p.portfolioUrl, source: p.sourceLabel, coverLetter: p.coverLetter, whyUs: p.whyUs,
    } : null,
    documents: has('cv') ? p.documents.map((d) => ({ id: d.id, originalName: d.originalName, extension: d.extension, isPrimary: d.isPrimary, createdAt: d.createdAt })) : [],
    notes: has('notes') ? [
      ...p.notes.map((n) => ({ text: n.note, author: n.author, createdAt: n.createdAt })),
      ...p.feedback.filter((f) => f.notes).map((f) => ({ text: f.notes!, author: f.author, createdAt: f.createdAt })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [],
    ai: has('ai') ? p.aiAnalysis : null,
    reviews: has('reviews') ? reviews : [],
    interviews: interviews.filter((i) => has('interviews') || i.transcript.length || i.recordings.length),
  };
}

type ShareRow = {
  id: number; application_id: number; recipient_email: string; recipient_name: string | null; message: string | null; sections: string[];
  allow_download: boolean; expires_at: Date | null; revoked_at: Date | null; created_by_name: string | null; created_at: Date; last_opened_at: Date | null; open_count: number;
};

const SHARE_SELECT = sql`
  select s.id, s.application_id, s.recipient_email::text as recipient_email, s.recipient_name, s.message, s.sections, s.allow_download, s.expires_at,
         s.revoked_at, u.name as created_by_name, s.created_at, s.last_opened_at, s.open_count
  from library_shares s left join users u on u.id = s.created_by`;

const shareStatus = (r: Pick<ShareRow, 'revoked_at' | 'expires_at'>): ShareStatus =>
  r.revoked_at ? 'off' : r.expires_at && r.expires_at.getTime() < Date.now() ? 'expired' : 'active';

const toShare = (r: ShareRow): LibraryShareDto => ({
  id: r.id, recipientEmail: r.recipient_email, recipientName: r.recipient_name, sections: r.sections.filter(isSection), allowDownload: r.allow_download,
  expiresAt: iso(r.expires_at), status: shareStatus(r), createdBy: r.created_by_name, createdAt: isoOrThrow(r.created_at),
  lastOpenedAt: iso(r.last_opened_at), openCount: r.open_count, revokedAt: iso(r.revoked_at),
});

const isSection = (s: string): s is LibrarySection => (LIBRARY_SECTIONS as readonly string[]).includes(s);

export async function detail(applicationId: number, ctx: Ctx): Promise<LibraryDetailDto> {
  const [file, shares] = await Promise.all([
    buildFile(applicationId, LIBRARY_SECTIONS),
    sql<ShareRow[]>`${SHARE_SELECT} where s.application_id = ${applicationId} order by s.created_at desc`,
  ]);
  await auditQuietly({ userId: ctx.user.id, action: 'library_file_opened', entityType: 'application', entityId: applicationId, details: { applicant: file.name }, ip: ctx.ip });
  return { file, shares: shares.map(toShare) };
}

// ---------------------------------------------------------------------------
// Staff: sharing
// ---------------------------------------------------------------------------

const EXPIRY_DAYS: Record<string, number | null> = { '7d': 7, '30d': 30, never: null };

export async function createShare(applicationId: number, input: z.infer<typeof createShareSchema>, ctx: Ctx): Promise<CreateShareResultDto> {
  const p = await candidates.profile(applicationId);
  const token = randomToken(24);
  const days = EXPIRY_DAYS[input.expiry] ?? null;
  const expiresAt = days ? new Date(Date.now() + days * 86_400_000) : null;
  const sections = LIBRARY_SECTIONS.filter((s) => input.sections.includes(s));
  const [row] = await sql<{ id: number }[]>`
    insert into library_shares (application_id, token_hash, recipient_email, recipient_name, message, sections, allow_download, expires_at, created_by)
    values (${applicationId}, ${sha256(token)}, ${input.recipientEmail}, ${input.recipientName || null}, ${input.message || null}, ${sections},
            ${input.allowDownload}, ${expiresAt}, ${ctx.user.id})
    returning id`;
  const link = appLink(`/shared/${token}`);
  const b = await brand();
  const result = await sendEmail({
    key: `library-share:${row!.id}`,
    template: 'library-share',
    to: input.recipientEmail,
    email: libraryShareInvite(b, {
      recipientName: input.recipientName || null, senderName: ctx.user.name, candidateName: p.name, jobTitle: p.job.title, link,
      message: input.message || null, expires: expiresAt ? expiresAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null,
    }),
  });
  await audit({
    userId: ctx.user.id, action: 'library_share_created', entityType: 'application', entityId: applicationId,
    details: { applicant: p.name, to: input.recipientEmail, parts: sections.join(', '), expires: input.expiry }, ip: ctx.ip,
  });
  const [created] = await sql<ShareRow[]>`${SHARE_SELECT} where s.id = ${row!.id}`;
  return { share: toShare(created!), email: result.outcome, link };
}

export async function revokeShare(shareId: number, ctx: Ctx): Promise<LibraryShareDto> {
  const [row] = await sql<{ id: number; application_id: number; recipient_email: string }[]>`
    update library_shares set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, ${ctx.user.id})
    where id = ${shareId} returning id, application_id, recipient_email::text as recipient_email`;
  if (!row) throw notFound('That share no longer exists.');
  await sql`delete from library_share_sessions where share_id = ${shareId}`;
  await audit({ userId: ctx.user.id, action: 'library_share_revoked', entityType: 'application', entityId: row.application_id, details: { to: row.recipient_email }, ip: ctx.ip });
  const [updated] = await sql<ShareRow[]>`${SHARE_SELECT} where s.id = ${shareId}`;
  return toShare(updated!);
}

// ---------------------------------------------------------------------------
// Files: CVs and recordings open through short signed links
// ---------------------------------------------------------------------------

async function documentLink(applicationId: number, documentId: number, download: boolean): Promise<{ url: string; name: string }> {
  const [doc] = await sql<{ storage_path: string; original_name: string; extension: string }[]>`
    select d.storage_path, d.original_name, d.extension from candidate_documents d join applications a on a.candidate_id = d.candidate_id
    where d.id = ${documentId} and a.id = ${applicationId}`;
  if (!doc) throw notFound('That document is not part of this file.');
  const inline = !download && doc.extension === 'pdf';
  const url = await storage.signedUrl(BUCKETS.resumes, doc.storage_path, { expiresIn: 120, ...(inline ? {} : { downloadName: doc.original_name }) });
  return { url, name: doc.original_name };
}

async function recordingLink(applicationId: number, recordingId: number): Promise<{ url: string }> {
  const [rec] = await sql<{ storage_path: string }[]>`
    select r.storage_path from interview_recordings r join interviews i on i.id = r.interview_id where r.id = ${recordingId} and i.application_id = ${applicationId}`;
  if (!rec) throw notFound('That recording is not part of this file.');
  return { url: await storage.signedUrl(BUCKETS.recordings, rec.storage_path, { expiresIn: 3600 }) };
}

export async function staffDocument(applicationId: number, documentId: number, download: boolean, ctx: Ctx) {
  const out = await documentLink(applicationId, documentId, download);
  await auditQuietly({ userId: ctx.user.id, action: 'document_downloaded', entityType: 'application', entityId: applicationId, details: { file: out.name, mode: download ? 'downloaded' : 'viewed', from: 'library' }, ip: ctx.ip });
  return { url: out.url };
}

export const staffRecording = (applicationId: number, recordingId: number) => recordingLink(applicationId, recordingId);

// ---------------------------------------------------------------------------
// The recipient (no account): landing, code, verified view
// ---------------------------------------------------------------------------

const gone = () => new AppError(404, 'not_found', 'This link is not valid. Ask the person who shared it to send it again.');

async function shareByToken(token: string): Promise<ShareRow> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw gone();
  const [row] = await sql<ShareRow[]>`${SHARE_SELECT} where s.token_hash = ${sha256(token)}`;
  if (!row) throw gone();
  return row;
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, local.length - 1)))}@${domain}`;
}

export async function landing(token: string): Promise<SharedLandingDto> {
  const row = await shareByToken(token);
  const b = await brand();
  const status = shareStatus(row);
  return { companyName: b.company, state: status === 'active' ? 'ok' : status, maskedEmail: maskEmail(row.recipient_email), sharedBy: row.created_by_name, expiresAt: iso(row.expires_at) };
}

const usable = (row: ShareRow) => {
  const status = shareStatus(row);
  if (status === 'off') throw new AppError(410, 'not_found', 'This share was turned off by the person who sent it.');
  if (status === 'expired') throw new AppError(410, 'not_found', 'This share has expired. Ask the person who sent it for a new one.');
};

/** Sends a code only when the address is the one the file was shared with; the reply never says which. */
export async function requestCode(token: string, email: string, ip: string | null): Promise<{ sent: true }> {
  const row = await shareByToken(token);
  usable(row);
  if (email.toLowerCase() !== row.recipient_email.toLowerCase()) {
    await auditQuietly({ userId: null, action: 'library_share_code_wrong_email', entityType: 'application', entityId: row.application_id, details: { tried: email }, ip });
    return { sent: true };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const [c] = await sql<{ id: number }[]>`
    insert into library_share_codes (share_id, code_hash, expires_at) values (${row.id}, ${sha256(`${row.id}:${code}`)}, ${new Date(Date.now() + CODE_TTL_MS)})
    returning id`;
  const [{ name } = { name: 'the applicant' }] = await sql<{ name: string }[]>`
    select c.first_name || coalesce(' ' || c.last_name, '') as name from applications a join candidates c on c.id = a.candidate_id where a.id = ${row.application_id}`;
  await sendEmail({ key: `library-code:${c!.id}`, template: 'library-share-code', to: row.recipient_email, email: libraryShareCode(await brand(), { code, candidateName: name }) });
  return { sent: true };
}

export async function verifyCode(token: string, email: string, code: string, ip: string | null): Promise<ShareViewerDto> {
  const row = await shareByToken(token);
  usable(row);
  const wrong = () => new AppError(422, 'validation_failed', 'That code is not right, or it has expired. Request a new code.', { code: 'That code is not right, or it has expired.' });
  if (email.toLowerCase() !== row.recipient_email.toLowerCase()) throw wrong();
  const [c] = await sql<{ id: number; code_hash: string; attempts: number }[]>`
    select id, code_hash, attempts from library_share_codes where share_id = ${row.id} and used_at is null and expires_at > now()
    order by created_at desc limit 1`;
  if (!c || c.attempts >= CODE_MAX_TRIES) throw wrong();
  if (!safeEqual(c.code_hash, sha256(`${row.id}:${code}`))) {
    await sql`update library_share_codes set attempts = attempts + 1 where id = ${c.id}`;
    throw wrong();
  }
  await sql`update library_share_codes set used_at = now() where id = ${c.id}`;
  const viewer = randomToken(32);
  const expiresAt = new Date(Date.now() + VIEWER_TTL_MS);
  await sql`insert into library_share_sessions (id, share_id, expires_at, ip) values (${sha256(viewer)}, ${row.id}, ${expiresAt}, ${ip})`;
  return { viewerToken: viewer, expiresAt: expiresAt.toISOString() };
}

async function viewerShare(token: string, viewer: string | undefined): Promise<ShareRow> {
  const row = await shareByToken(token);
  usable(row);
  const signIn = () => new AppError(403, 'forbidden', 'Enter the code we email you to open this file.', undefined, { kind: 'share_code' });
  if (!viewer || viewer.length < 20) throw signIn();
  const [s] = await sql<{ share_id: number }[]>`select share_id from library_share_sessions where id = ${sha256(viewer)} and expires_at > now()`;
  if (!s || s.share_id !== row.id) throw signIn();
  return row;
}

export async function sharedFile(token: string, viewer: string | undefined, ip: string | null): Promise<SharedFileDto> {
  const row = await viewerShare(token, viewer);
  const sections = row.sections.filter(isSection);
  const file = await buildFile(row.application_id, sections);
  await sql`update library_shares set open_count = open_count + 1, last_opened_at = now() where id = ${row.id}`;
  await auditQuietly({ userId: null, action: 'library_share_opened', entityType: 'application', entityId: row.application_id, details: { by: row.recipient_email }, ip });
  const b = await brand();
  return {
    companyName: b.company, sharedBy: row.created_by_name, message: row.message, recipientEmail: row.recipient_email,
    allowDownload: row.allow_download, expiresAt: iso(row.expires_at), file,
  };
}

export async function sharedDocument(token: string, viewer: string | undefined, documentId: number, download: boolean, ip: string | null) {
  const row = await viewerShare(token, viewer);
  if (!row.sections.includes('cv')) throw notFound('The CV is not part of this share.');
  if (download && !row.allow_download) throw new AppError(403, 'forbidden', 'Downloading is turned off for this share.');
  const out = await documentLink(row.application_id, documentId, download);
  await auditQuietly({ userId: null, action: 'library_share_document', entityType: 'application', entityId: row.application_id, details: { by: row.recipient_email, file: out.name, mode: download ? 'downloaded' : 'viewed' }, ip });
  return { url: out.url };
}

export async function sharedRecording(token: string, viewer: string | undefined, recordingId: number, ip: string | null) {
  const row = await viewerShare(token, viewer);
  if (!row.sections.includes('recordings')) throw notFound('Recordings are not part of this share.');
  const out = await recordingLink(row.application_id, recordingId);
  await auditQuietly({ userId: null, action: 'library_share_recording', entityType: 'application', entityId: row.application_id, details: { by: row.recipient_email }, ip });
  return out;
}
