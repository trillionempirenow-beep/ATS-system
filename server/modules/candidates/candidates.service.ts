import type { z } from 'zod';
import {
  CONFIGURABLE_CANDIDATE_FIELDS, MANUAL_SOURCES, STAGE_LABELS, sourceLabel, type ConfigurableCandidateField, type ReviewStage,
} from '../../../shared/domain/pipeline.js';
import { isAdminLevel } from '../../../shared/domain/access.js';
import { jobTags } from '../../../shared/domain/jobs.js';
import { interviewDisplayState } from '../../../shared/domain/interviews.js';
import { formatBytes } from '../../../shared/api/uploads.js';
import type {
  ActivityDto, AddCandidateResultDto, CandidateListDto, CandidateProfileDto, ParseCvResultDto,
  addCandidateSchema, candidateListQuerySchema, convertEmployeeSchema, feedbackSchema, profileUpdateSchema, stageReviewSchema, suggestionSchema,
} from '../../../shared/api/candidates.js';
import { sql, transaction } from '../../db/client.js';
import { audit } from '../../core/audit.js';
import { getSettings, setSettings } from '../../core/settings.js';
import type { CurrentUser } from '../../http/context.js';
import { conflict, forbidden, isUniqueViolation, notFound, validationFailed } from '../../http/errors.js';
import { fullName, iso, isoOrThrow } from '../../lib/format.js';
import { emitN8nEvent } from '../../integrations/n8n/n8n.client.js';
import { extractDocumentText } from '../../parsers/text-extract.js';
import { parseResumeText, type ParsedResumeFields } from '../../parsers/resume-parser.js';
import { parseResumeWithAi } from '../../parsers/resume-ai.js';

const pick = (f: ParsedResumeFields, keys: Array<keyof ParsedResumeFields>): ParsedResumeFields =>
  Object.fromEntries(keys.filter((k) => f[k]).map((k) => [k, f[k]]));
import { avatarUrlForCandidate } from '../media/media.urls.js';
import { consumeUpload } from '../uploads/uploads.service.js';
import { analyseApplication } from './application-analysis.js';
import * as repo from './candidates.repository.js';

type Ctx = { user: CurrentUser; ip: string | null };

export async function list(q: z.infer<typeof candidateListQuerySchema>): Promise<CandidateListDto> {
  const [rows, counts, options] = await Promise.all([repo.listCandidates(q), repo.stageCounts(), repo.filterOptions()]);
  const total = rows[0]?.total ?? 0;
  const stageCounts = Object.fromEntries(counts.map((c) => [c.stage, c.n]));
  return {
    rows: rows.map((r) => ({
      applicationId: r.application_id,
      candidateId: r.candidate_id,
      name: fullName(r.first_name, r.last_name),
      email: r.email,
      avatarUrl: avatarUrlForCandidate(r.candidate_id, r.profile_image),
      stage: r.stage,
      jobId: r.job_id,
      jobTitle: r.job_title,
      rating: r.rating,
      source: sourceLabel(r.source),
      ownerName: r.owner_name,
      appliedAt: isoOrThrow(r.applied_at),
      hasResume: Boolean(r.primary_doc_id || r.resume_path),
      primaryDocumentId: r.primary_doc_id,
    })),
    total,
    page: q.page,
    pageCount: Math.max(1, Math.ceil(total / repo.PAGE_SIZE)),
    stageCounts,
    totalActive: counts.reduce((s, c) => s + c.n, 0),
    options,
  };
}

const ACTION_LABELS: Record<string, string> = {
  candidate_note: 'Note added',
  candidate_feedback: 'Feedback saved',
  candidate_rating: 'Rating updated',
  candidate_role_suggestion: 'Role suggestion saved',
  screening_review: 'Screening review saved',
  interview_review: 'Interview review saved',
  final_interview_review: 'Final interview review saved',
  meeting_review: 'Meeting review saved',
  ai_analysis_generated: 'Application analysis generated',
  candidate_converted_to_employee: 'Added to Employees',
  application_submitted: 'Applied on the careers site',
  application_withdrawn: 'Withdrew the application',
  candidate_added_manually: 'Added manually',
  candidate_saved_as_draft: 'Saved as a draft',
  document_uploaded: 'Resume uploaded',
  document_downloaded: 'Resume opened',
  candidate_profile_updated: 'Profile details updated',
  application_status_change: 'Application status changed',
};

function activityLabel(action: string, details: Record<string, unknown> | null): string {
  if (action === 'pipeline_stage_move' && details) {
    const from = STAGE_LABELS[details.from as keyof typeof STAGE_LABELS] ?? String(details.from);
    const to = STAGE_LABELS[details.to as keyof typeof STAGE_LABELS] ?? String(details.to);
    return `Moved from ${from} to ${to}${details.override ? ' (admin override)' : ''}`;
  }
  return ACTION_LABELS[action] ?? action.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export async function profile(applicationId: number): Promise<CandidateProfileDto> {
  const row = await repo.profile(applicationId);
  if (!row) throw notFound('This application may have been removed.');
  const [others, docs, notes, feedback, suggestions, openRoles, reviews, ai, interviews, activity, employee, departments] = await Promise.all([
    repo.otherApplications(row.candidate_id, applicationId),
    repo.documents(row.candidate_id),
    repo.notes(row.candidate_id),
    repo.feedback(applicationId),
    repo.suggestions(applicationId),
    repo.openRolesExcept(row.job_id),
    repo.stageReviews(applicationId),
    repo.aiAnalysis(applicationId),
    repo.interviewHistory(row.candidate_id),
    repo.activity(applicationId, row.candidate_id),
    repo.employeeForApplication(applicationId),
    repo.departments(),
  ]);
  const review = (t: ReviewStage) => {
    const r = reviews.find((x) => x.stage_type === t);
    return r ? { stageType: t, rating: r.rating, feedback: r.feedback, notes: r.notes, reviewer: r.reviewer, updatedAt: isoOrThrow(r.updated_at) } : null;
  };
  return {
    applicationId: row.application_id,
    candidateId: row.candidate_id,
    firstName: row.first_name,
    lastName: row.last_name,
    name: fullName(row.first_name, row.last_name),
    email: row.email,
    phone: row.phone,
    avatarUrl: avatarUrlForCandidate(row.candidate_id, row.profile_image),
    portfolioUrl: row.portfolio_url,
    source: row.source,
    sourceLabel: sourceLabel(row.source),
    rating: row.rating,
    currentTitle: row.current_title,
    experienceLevel: row.experience_level,
    skills: row.skills,
    education: row.education,
    candidateNotes: row.candidate_notes,
    recordStatus: row.record_status,
    consentAt: iso(row.consent_at),
    candidateCreatedAt: isoOrThrow(row.candidate_created),
    stage: row.stage,
    applicationStatus: row.app_status,
    appliedAt: isoOrThrow(row.applied_at),
    updatedAt: isoOrThrow(row.updated_at),
    coverLetter: row.cover_letter,
    whyUs: row.why_us,
    job: { id: row.job_id, title: row.job_title, tags: jobTags(row.job_tags), location: row.job_location, employmentType: row.employment_type, department: row.department },
    assignedTo: row.assigned_to ? { id: row.assigned_to, name: row.assigned_name ?? '' } : null,
    otherApplications: others.map((o) => ({ applicationId: o.application_id, jobTitle: o.job_title, stage: o.stage, withdrawn: o.status === 'withdrawn' })),
    documents: docs.map((d) => ({ id: d.id, originalName: d.original_name, extension: d.extension, byteSize: d.byte_size, isPrimary: d.is_primary, parsed: d.parsed, uploadedBy: d.uploader, createdAt: isoOrThrow(d.created_at) })),
    legacyResumePath: docs.length ? null : row.resume_path,
    resumeIndexed: row.resume_len > 40,
    notes: notes.map((n) => ({ id: n.id, note: n.note, author: n.author, createdAt: isoOrThrow(n.created_at) })),
    feedback: feedback.map((f) => ({ id: f.id, fit: f.fit, notes: f.notes, author: f.author, createdAt: isoOrThrow(f.created_at) })),
    suggestions: suggestions.map((s) => ({ id: s.id, jobId: s.job_id, jobTitle: s.job_title, note: s.note, author: s.author, createdAt: isoOrThrow(s.created_at) })),
    openRoles,
    screeningReview: review('screening'),
    interviewReview: review('interview'),
    finalInterviewReview: review('final_interview'),
    aiAnalysis: ai
      ? { overallScore: ai.overall_score, categoryScores: ai.category_scores, summary: ai.summary, strengths: ai.strengths, concerns: ai.concerns, recommendation: ai.recommendation, notes: ai.ai_notes, generatedAt: isoOrThrow(ai.generated_at) }
      : null,
    interviews: interviews.map((i) => ({
      id: i.id, meetingType: i.meeting_type, interviewType: i.interview_type, startsAt: isoOrThrow(i.starts_at), jobTitle: i.job_title,
      interviewerName: i.interviewer_name, reviewerName: i.reviewer_name,
      state: interviewDisplayState({ status: i.status, meeting_state: i.meeting_state, starts_at: isoOrThrow(i.starts_at) }),
      score: i.score, recommendation: i.recommendation, feedback: i.feedback, liveNotes: i.live_notes, roomCode: i.room_code,
    })),
    activity: activity.map((a): ActivityDto => ({ id: a.id, action: a.action, label: activityLabel(a.action, a.details), actor: a.actor, details: a.details, createdAt: isoOrThrow(a.created_at) })),
    employee: employee ? { id: employee.id, employeeNumber: employee.employee_number, jobTitle: employee.job_title, department: employee.department, startDate: employee.start_date, status: employee.status } : null,
    departments,
  };
}

async function basics(applicationId: number) {
  const app = await repo.applicationBasics(applicationId);
  if (!app) throw notFound('This application may have been removed.');
  return app;
}

export async function addNote(applicationId: number, note: string, ctx: Ctx): Promise<void> {
  const app = await basics(applicationId);
  await transaction(async (tx) => {
    await tx`insert into candidate_notes (candidate_id, author_id, note) values (${app.candidate_id}, ${ctx.user.id}, ${note})`;
    await audit({ userId: ctx.user.id, action: 'candidate_note', entityType: 'candidate', entityId: app.candidate_id, ip: ctx.ip }, tx);
  });
}

export async function setRating(applicationId: number, rating: number, ctx: Ctx): Promise<void> {
  const app = await basics(applicationId);
  await transaction(async (tx) => {
    await tx`update candidates set rating = ${rating} where id = ${app.candidate_id}`;
    await audit({ userId: ctx.user.id, action: 'candidate_rating', entityType: 'candidate', entityId: app.candidate_id, details: { rating }, ip: ctx.ip }, tx);
  });
}

export async function addFeedback(applicationId: number, input: z.infer<typeof feedbackSchema>, ctx: Ctx): Promise<void> {
  await basics(applicationId);
  await transaction(async (tx) => {
    await tx`insert into candidate_feedback (application_id, author_id, fit, notes) values (${applicationId}, ${ctx.user.id}, ${input.fit}, ${input.notes || null})`;
    await audit({ userId: ctx.user.id, action: 'candidate_feedback', entityType: 'application', entityId: applicationId, ip: ctx.ip }, tx);
  });
}

export async function addSuggestion(applicationId: number, input: z.infer<typeof suggestionSchema>, ctx: Ctx): Promise<void> {
  await basics(applicationId);
  const [job] = await sql<{ id: number }[]>`select id from jobs where id = ${input.jobId} and status = 'open'`;
  if (!job) throw validationFailed({ jobId: 'Choose one of the open roles.' });
  await transaction(async (tx) => {
    await tx`insert into candidate_role_suggestions (application_id, suggested_job_id, note, author_id) values (${applicationId}, ${input.jobId}, ${input.note || null}, ${ctx.user.id})`;
    await audit({ userId: ctx.user.id, action: 'candidate_role_suggestion', entityType: 'application', entityId: applicationId, ip: ctx.ip }, tx);
  });
}

export async function saveStageReview(applicationId: number, stageType: ReviewStage, input: z.infer<typeof stageReviewSchema>, ctx: Ctx): Promise<void> {
  await basics(applicationId);
  await transaction(async (tx) => {
    await tx`insert into stage_reviews (application_id, stage_type, rating, feedback, notes, reviewer_id)
             values (${applicationId}, ${stageType}, ${input.rating}, ${input.feedback || null}, ${input.notes || null}, ${ctx.user.id})
             on conflict (application_id, stage_type) do update set rating = excluded.rating, feedback = excluded.feedback,
               notes = excluded.notes, reviewer_id = excluded.reviewer_id, updated_at = now()`;
    await audit({ userId: ctx.user.id, action: `${stageType}_review`, entityType: 'application', entityId: applicationId, ip: ctx.ip }, tx);
  });
}

export async function runAnalysis(applicationId: number, ctx: Ctx): Promise<void> {
  const app = await basics(applicationId);
  const [doc] = await sql<{ id: number }[]>`select id from candidate_documents where candidate_id = ${app.candidate_id} limit 1`;
  const a = analyseApplication({
    candidateId: app.candidate_id, applicationId, coverLetter: app.cover_letter, whyUs: app.why_us,
    hasResume: Boolean(doc || app.resume_path), portfolioUrl: app.portfolio_url, jobTitle: app.job_title, jobTags: app.job_tags,
  });
  await transaction(async (tx) => {
    await tx`insert into candidate_ai_analysis (application_id, overall_score, category_scores, summary, strengths, concerns, recommendation, ai_notes)
             values (${applicationId}, ${a.overall_score}, ${tx.json(a.category_scores)}, ${a.summary}, ${tx.json(a.strengths)}, ${tx.json(a.concerns)}, ${a.recommendation}, ${a.ai_notes})
             on conflict (application_id) do update set overall_score = excluded.overall_score, category_scores = excluded.category_scores,
               summary = excluded.summary, strengths = excluded.strengths, concerns = excluded.concerns,
               recommendation = excluded.recommendation, ai_notes = excluded.ai_notes, generated_at = now()`;
    await audit({ userId: ctx.user.id, action: 'ai_analysis_generated', entityType: 'application', entityId: applicationId, ip: ctx.ip }, tx);
  });
}

export async function updateProfile(applicationId: number, input: z.infer<typeof profileUpdateSchema>, ctx: Ctx): Promise<void> {
  const app = await basics(applicationId);
  if (input.portfolioUrl && !/^https?:\/\//i.test(input.portfolioUrl)) throw validationFailed({ portfolioUrl: 'Use a full URL starting with https://' });
  await transaction(async (tx) => {
    await tx`update candidates set first_name = ${input.firstName}, last_name = ${input.lastName}, email = ${input.email},
               phone = ${input.phone || null}, current_title = ${input.currentTitle || null}, experience_level = ${input.experienceLevel ?? null},
               skills = ${input.skills || null}, education = ${input.education || null}, portfolio_url = ${input.portfolioUrl || null}
             where id = ${app.candidate_id}`;
    await audit({ userId: ctx.user.id, action: 'candidate_profile_updated', entityType: 'candidate', entityId: app.candidate_id, ip: ctx.ip }, tx);
  });
}

/** A new resume becomes the primary version; earlier ones stay in the history. */
export async function addDocument(applicationId: number, uploadId: string, ctx: Ctx): Promise<void> {
  const app = await basics(applicationId);
  const file = await consumeUpload(uploadId, 'resume', ctx.user, 'documents', 'uploadId');
  const parsed = await extractDocumentText(file.data, file.extension).catch(() => null);
  await transaction(async (tx) => {
    await tx`update candidate_documents set is_primary = false where candidate_id = ${app.candidate_id}`;
    await tx`insert into candidate_documents (candidate_id, storage_path, original_name, extension, mime_type, byte_size, is_primary, parsed, uploaded_by)
             values (${app.candidate_id}, ${file.path}, ${file.originalName}, ${file.extension}, ${file.mime}, ${file.size}, true, ${Boolean(parsed && !parsed.error)}, ${ctx.user.id})`;
    if (parsed && !parsed.error && parsed.text) await tx`update candidates set resume_text = ${parsed.text.slice(0, 60000)} where id = ${app.candidate_id}`;
    await audit({ userId: ctx.user.id, action: 'document_uploaded', entityType: 'candidate', entityId: app.candidate_id, details: { file: file.originalName }, ip: ctx.ip }, tx);
  });
}

export async function convertToEmployee(applicationId: number, input: z.infer<typeof convertEmployeeSchema>, ctx: Ctx): Promise<{ employeeId: number }> {
  const app = await basics(applicationId);
  if (app.stage !== 'hired') throw conflict('Only hired candidates can be added to Employees.');
  const [existing] = await sql<{ id: number }[]>`select id from employees where application_id = ${applicationId}`;
  if (existing) throw conflict('This candidate already has an employee record.');
  const year = new Date().getFullYear();
  const employeeNumber = input.employeeNumber || `EMP-${year}-${String(applicationId).padStart(4, '0')}`;
  const startDate = input.startDate || new Date().toISOString().slice(0, 10);
  try {
    const employeeId = await transaction(async (tx) => {
      const [e] = await tx<{ id: number }[]>`
        insert into employees (candidate_id, application_id, applied_position, employee_number, job_title, department_id, start_date, status)
        values (${app.candidate_id}, ${applicationId}, ${app.job_title}, ${employeeNumber}, ${input.hiredPosition || app.job_title},
                ${input.departmentId ?? null}, ${startDate}, 'active') returning id`;
      await audit({ userId: ctx.user.id, action: 'candidate_converted_to_employee', entityType: 'employee', entityId: e!.id, ip: ctx.ip }, tx);
      await audit({ userId: ctx.user.id, action: 'candidate_converted_to_employee', entityType: 'application', entityId: applicationId, details: { employee_number: employeeNumber }, ip: ctx.ip }, tx);
      return e!.id;
    });
    emitN8nEvent('candidate.hired_to_employee', { applicationId, employeeId, employeeNumber });
    return { employeeId };
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('That employee number is already in use.');
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Add candidate and CV parsing
// ---------------------------------------------------------------------------

export async function requiredFields(): Promise<string[]> {
  const s = await getSettings();
  let list: unknown;
  try { list = JSON.parse(s.candidate_required_fields); } catch { list = []; }
  const picked = Array.isArray(list) ? list.filter((f): f is string => typeof f === 'string') : [];
  return [...new Set(['full_name', 'email', ...picked])];
}

export async function setRequiredFields(fields: ConfigurableCandidateField[], ctx: Ctx): Promise<void> {
  if (!isAdminLevel(ctx.user)) throw forbidden('Only an Admin can change which fields are required.');
  await setSettings(sql, { candidate_required_fields: JSON.stringify(['full_name', 'email', ...fields]) });
  await audit({ userId: ctx.user.id, action: 'candidate_required_fields_changed', entityType: 'settings', details: { required: fields.join(', ') || 'name and email only' }, ip: ctx.ip });
}

/** Stores the file first (it is the record either way), then suggests field values. */
export async function parseCv(uploadId: string, ctx: Ctx): Promise<ParseCvResultDto> {
  const file = await consumeUpload(uploadId, 'resume', ctx.user, 'documents', 'uploadId');
  const [doc] = await sql<{ id: number }[]>`
    insert into candidate_documents (candidate_id, storage_path, original_name, extension, mime_type, byte_size, is_primary, uploaded_by)
    values (null, ${file.path}, ${file.originalName}, ${file.extension}, ${file.mime}, ${file.size}, true, ${ctx.user.id}) returning id`;
  const document = { id: doc!.id, originalName: file.originalName, extension: file.extension, sizeLabel: formatBytes(file.size) };
  const extracted = await extractDocumentText(file.data, file.extension);
  const hasText = !extracted.error && extracted.text.trim().length >= 40;
  // Claude reads PDFs as documents (any layout, scanned pages too) and other formats as text.
  const aiResult = file.extension === 'pdf' || hasText
    ? await parseResumeWithAi(file.extension === 'pdf' ? { pdf: file.data } : { text: extracted.text })
    : null;
  const ai = aiResult?.fields ?? null;
  // Said on screen, so a broken key or used-up quota is visible without the server logs.
  const aiNote = aiResult?.error ? ` The AI reader was unavailable (${aiResult.error}), so the basic reader was used.` : '';
  if (!ai && !hasText) {
    return {
      ok: false, code: 'ERR_CORRUPT_FILE',
      message: (extracted.error ?? 'Parsing failed: the document appears to be corrupted or encrypted. Please enter details manually.') + aiNote,
      document, fields: {}, filled: [], partial: true, resumeText: '',
    };
  }
  await sql`update candidate_documents set parsed = true where id = ${doc!.id}`;
  // The rules still back up contact details the AI left empty (email and phone patterns are reliable).
  const rules = hasText ? parseResumeText(extracted.text) : {};
  const fields = ai ? { ...pick(rules, ['email', 'phone']), ...ai } : rules;
  const filled = Object.keys(fields);
  return {
    ok: true,
    message: filled.length
      ? `Auto-filled ${filled.length} field${filled.length === 1 ? '' : 's'}${ai ? ' with AI' : ''}. Please check each one before saving.${aiNote}`
      : `The file was read, but nothing recognisable was found. Please enter the details manually.${aiNote}`,
    document,
    fields: fields as ParseCvResultDto['fields'],
    filled,
    partial: filled.length < 3,
    resumeText: extracted.text.slice(0, 60000),
  };
}

export async function addCandidate(input: z.infer<typeof addCandidateSchema>, ctx: Ctx): Promise<AddCandidateResultDto> {
  const isDraft = input.action === 'draft';
  const required = isDraft ? ['full_name'] : await requiredFields();
  const values: Record<string, string | number | null> = {
    full_name: input.fullName, email: input.email, phone: input.phone, current_title: input.currentTitle,
    experience_level: input.experienceLevel, skills: input.skills, education: input.education, source: input.source, job_id: input.jobId,
  };
  const errors: Record<string, string> = {};
  const camel: Record<string, string> = { full_name: 'fullName', current_title: 'currentTitle', experience_level: 'experienceLevel', job_id: 'jobId' };
  for (const f of required) {
    const v = values[f];
    if (v === null || v === '' || v === undefined) {
      const label = f === 'full_name' ? 'Full name' : f === 'email' ? 'Email' : CONFIGURABLE_CANDIDATE_FIELDS[f as ConfigurableCandidateField] ?? f;
      errors[camel[f] ?? f] = `${label} is required.`;
    }
  }
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) errors.email = 'That email address is not valid.';
  if (input.phone && !/^[\d\s()+.-]{7,20}$/.test(input.phone)) errors.phone = 'That phone number does not look valid.';
  if (input.jobId) {
    const [job] = await sql<{ id: number }[]>`select id from jobs where id = ${input.jobId} and status = 'open'`;
    if (!job) errors.jobId = 'Choose one of the open roles.';
  }
  if (Object.keys(errors).length) throw validationFailed(errors);

  const email = input.email.toLowerCase();
  const [first, ...rest] = input.fullName.split(/\s+/);
  const result = await transaction(async (tx) => {
    const [existing] = email ? await tx<{ id: number }[]>`select id from candidates where email = ${email} order by id desc limit 1` : [];
    let candidateId: number;
    if (existing) {
      candidateId = existing.id;
      await tx`update candidates set first_name = ${first ?? ''}, last_name = ${rest.join(' ')}, phone = ${input.phone || null},
                 current_title = ${input.currentTitle || null}, experience_level = ${input.experienceLevel || null}, skills = ${input.skills || null},
                 education = ${input.education || null}, notes = ${input.notes || null}, source = ${input.source},
                 record_status = ${isDraft ? 'draft' : 'active'} where id = ${candidateId}`;
    } else {
      const [c] = await tx<{ id: number }[]>`
        insert into candidates (first_name, last_name, email, phone, current_title, experience_level, skills, education, notes, source, record_status, created_by)
        values (${first ?? ''}, ${rest.join(' ')}, ${email}, ${input.phone || null}, ${input.currentTitle || null}, ${input.experienceLevel || null},
                ${input.skills || null}, ${input.education || null}, ${input.notes || null}, ${input.source}, ${isDraft ? 'draft' : 'active'}, ${ctx.user.id})
        returning id`;
      candidateId = c!.id;
    }
    let applicationId: number | null = null;
    if (!isDraft && input.jobId) {
      const [found] = await tx<{ id: number }[]>`select id from applications where candidate_id = ${candidateId} and job_id = ${input.jobId}`;
      if (found) applicationId = found.id;
      else {
        const [a] = await tx<{ id: number }[]>`
          insert into applications (candidate_id, job_id, stage, status, assigned_to) values (${candidateId}, ${input.jobId}, 'new', 'active', ${ctx.user.id}) returning id`;
        applicationId = a!.id;
      }
    }
    let attached = false;
    if (input.documentId) {
      const [doc] = await tx<{ id: number }[]>`select id from candidate_documents where id = ${input.documentId} and candidate_id is null and uploaded_by = ${ctx.user.id}`;
      if (doc) {
        await tx`update candidate_documents set is_primary = false where candidate_id = ${candidateId}`;
        await tx`update candidate_documents set candidate_id = ${candidateId}, is_primary = true where id = ${doc.id}`;
        attached = true;
      }
    }
    if (input.resumeText.trim()) await tx`update candidates set resume_text = ${input.resumeText.slice(0, 60000)} where id = ${candidateId}`;
    await audit({
      userId: ctx.user.id, action: isDraft ? 'candidate_saved_as_draft' : 'candidate_added_manually', entityType: 'candidate', entityId: candidateId,
      details: { name: input.fullName, source: MANUAL_SOURCES[input.source], cv_parsed: input.cvParsed ? 'Yes' : 'No', document: attached ? 'attached' : 'none', added_by: ctx.user.name },
      ip: ctx.ip,
    }, tx);
    return { candidateId, applicationId };
  });
  if (!isDraft) emitN8nEvent('candidate.created', { candidateId: result.candidateId, applicationId: result.applicationId, source: input.source, actorId: ctx.user.id });
  return { ...result, draft: isDraft };
}

export async function openJobsForForms() {
  return sql<{ id: number; title: string }[]>`select id, title from jobs where status = 'open' order by title`;
}
