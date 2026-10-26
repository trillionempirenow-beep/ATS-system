import { z } from 'zod';
import type { Stage } from '../domain/pipeline.js';
import type { AiAnalysisDto, StageReviewDto } from './candidates.js';
import type { AiSummary } from './interviews.js';

/** What a Library file is made of; a share picks which of these the recipient sees. */
export const LIBRARY_SECTIONS = ['details', 'cv', 'notes', 'ai', 'reviews', 'interviews', 'transcripts', 'recordings'] as const;
export type LibrarySection = (typeof LIBRARY_SECTIONS)[number];

export const LIBRARY_SECTION_LABELS: Record<LibrarySection, { label: string; hint: string }> = {
  details: { label: 'Details', hint: 'Contact details, role applied for, experience, skills and their application answers' },
  cv: { label: 'CV / resume', hint: 'Every uploaded CV and document' },
  notes: { label: 'Recruiter notes', hint: 'Notes and feedback the hiring team wrote' },
  ai: { label: 'AI analysis', hint: 'The AI score, strengths and concerns' },
  reviews: { label: 'Scores', hint: 'Screening and interview reviews with ratings' },
  interviews: { label: 'Interview summaries', hint: 'Each interview with its AI summary and the interviewer\'s feedback' },
  transcripts: { label: 'Transcripts', hint: 'What was said in each interview, as transcribed by AI notes' },
  recordings: { label: 'Recordings', hint: 'Video recordings of interviews that were recorded' },
};

/** Sections a new share starts with: the hiring manager's usual questions, not the team's private notes. */
export const DEFAULT_SHARE_SECTIONS: LibrarySection[] = ['details', 'cv', 'ai', 'reviews', 'interviews', 'recordings'];

export interface LibraryRowDto {
  applicationId: number;
  name: string;
  email: string;
  jobTitle: string;
  stage: Stage;
  withdrawn: boolean;
  appliedAt: string;
  documents: number;
  interviews: number;
  summaries: number;
  recordings: number;
  activeShares: number;
}

export interface LibraryListDto {
  rows: LibraryRowDto[];
  total: number;
  page: number;
  pageSize: number;
  jobs: Array<{ id: number; title: string }>;
}

export const libraryListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  job: z.coerce.number().int().positive().optional(),
  stage: z.string().max(40).optional(),
  has: z.enum(['recording', 'summary', 'shared']).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

export interface LibraryDocumentDto { id: number; originalName: string; extension: string; isPrimary: boolean; createdAt: string }
export interface LibraryRecordingDto { id: number; seq: number; durationSec: number; sizeBytes: number; startedAt: string }
export interface LibraryInterviewDto {
  id: number;
  kind: string;
  startsAt: string;
  interviewerName: string | null;
  state: string;
  score: number | null;
  recommendation: string | null;
  feedback: string | null;
  aiSummary: AiSummary | null;
  transcript: Array<{ atSecond: number; text: string }>;
  recordings: LibraryRecordingDto[];
}

/** One applicant's file. A shared copy only carries the sections that were shared. */
export interface LibraryFileDto {
  applicationId: number;
  sections: LibrarySection[];
  name: string;
  jobTitle: string;
  department: string | null;
  stage: Stage;
  withdrawn: boolean;
  appliedAt: string;
  details: {
    email: string;
    phone: string | null;
    currentTitle: string | null;
    experience: string | null;
    skills: string[];
    education: string | null;
    portfolioUrl: string | null;
    source: string;
    coverLetter: string | null;
    whyUs: string | null;
  } | null;
  documents: LibraryDocumentDto[];
  notes: Array<{ text: string; author: string | null; createdAt: string }>;
  ai: AiAnalysisDto | null;
  reviews: Array<StageReviewDto & { label: string }>;
  interviews: LibraryInterviewDto[];
}

export type ShareStatus = 'active' | 'expired' | 'off';

export interface LibraryShareDto {
  id: number;
  recipientEmail: string;
  recipientName: string | null;
  sections: LibrarySection[];
  allowDownload: boolean;
  expiresAt: string | null;
  status: ShareStatus;
  createdBy: string | null;
  createdAt: string;
  lastOpenedAt: string | null;
  openCount: number;
  revokedAt: string | null;
}

export interface LibraryDetailDto {
  file: LibraryFileDto;
  shares: LibraryShareDto[];
}

export const SHARE_EXPIRY = ['7d', '30d', 'never'] as const;
export type ShareExpiry = (typeof SHARE_EXPIRY)[number];

export const createShareSchema = z.object({
  recipientEmail: z.string().trim().email('Enter the email address of the person you are sharing with.').max(190).transform((v) => v.toLowerCase()),
  recipientName: z.string().trim().max(120).optional().default(''),
  message: z.string().trim().max(1000).optional().default(''),
  sections: z.array(z.enum(LIBRARY_SECTIONS)).min(1, 'Choose at least one part of the file to share.'),
  allowDownload: z.boolean().default(true),
  expiry: z.enum(SHARE_EXPIRY).default('30d'),
});
export type CreateShareInput = z.input<typeof createShareSchema>;

export interface CreateShareResultDto {
  share: LibraryShareDto;
  email: 'sent' | 'skipped' | 'failed' | 'not_configured' | 'duplicate';
  /** The link, so staff can copy it if the email did not go out. */
  link: string;
}

// ---- The recipient's side (no account) -------------------------------------

export interface SharedLandingDto {
  companyName: string;
  state: 'ok' | 'expired' | 'off';
  /** The address the file was sent to, partly hidden (j•••@acme.com). */
  maskedEmail: string;
  sharedBy: string | null;
  expiresAt: string | null;
}

export const shareCodeRequestSchema = z.object({ email: z.string().trim().email('Enter the email address this was sent to.').max(190).transform((v) => v.toLowerCase()) });
export const shareCodeVerifySchema = z.object({
  email: z.string().trim().email().max(190).transform((v) => v.toLowerCase()),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.'),
});

export interface ShareViewerDto { viewerToken: string; expiresAt: string }

export interface SharedFileDto {
  companyName: string;
  sharedBy: string | null;
  message: string | null;
  recipientEmail: string;
  allowDownload: boolean;
  expiresAt: string | null;
  file: LibraryFileDto;
}
