import { z } from 'zod';
import {
  CONFIGURABLE_CANDIDATE_FIELDS, EXPERIENCE_LEVELS, FEEDBACK_FITS, MANUAL_SOURCES, STAGES,
  type ExperienceLevel, type FeedbackFit, type ReviewStage, type Stage,
} from '../domain/pipeline.js';
import type { DisplayInterviewState, InterviewType, MeetingType, Recommendation } from '../domain/interviews.js';
import type { EmploymentType } from '../domain/jobs.js';
import type { EmployeeStatus } from '../domain/people.js';

export const candidateListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  stage: z.enum(STAGES).optional(),
  job: z.coerce.number().int().positive().optional(),
  owner: z.coerce.number().int().positive().optional(),
  rating: z.union([z.literal('unrated'), z.coerce.number().int().min(1).max(5)]).optional(),
  sort: z.enum(['recent', 'oldest', 'name', 'rating', 'role']).default('recent'),
  page: z.coerce.number().int().min(1).default(1),
});
export type CandidateListQuery = z.input<typeof candidateListQuerySchema>;

export interface CandidateRowDto {
  applicationId: number;
  candidateId: number;
  name: string;
  email: string;
  avatarUrl: string | null;
  stage: Stage;
  jobId: number;
  jobTitle: string;
  rating: number;
  source: string;
  ownerName: string | null;
  appliedAt: string;
  hasResume: boolean;
  primaryDocumentId: number | null;
}

export interface CandidateListDto {
  rows: CandidateRowDto[];
  total: number;
  page: number;
  pageCount: number;
  stageCounts: Partial<Record<Stage, number>>;
  totalActive: number;
  options: { jobs: Array<{ id: number; title: string }>; owners: Array<{ id: number; name: string }> };
}

export interface DocumentDto {
  id: number;
  originalName: string;
  extension: 'pdf' | 'doc' | 'docx';
  byteSize: number;
  isPrimary: boolean;
  parsed: boolean;
  uploadedBy: string | null;
  createdAt: string;
}

export interface NoteDto { id: number; note: string; author: string | null; createdAt: string }
export interface FeedbackDto { id: number; fit: FeedbackFit; notes: string | null; author: string | null; createdAt: string }
export interface SuggestionDto { id: number; jobId: number; jobTitle: string; note: string | null; author: string | null; createdAt: string }
export interface StageReviewDto { stageType: ReviewStage; rating: number | null; feedback: string | null; notes: string | null; reviewer: string | null; updatedAt: string }
export interface AiAnalysisDto {
  overallScore: number;
  categoryScores: Record<string, number>;
  summary: string;
  strengths: string[];
  concerns: string[];
  recommendation: string;
  notes: string;
  generatedAt: string;
}
export interface ActivityDto { id: number; action: string; label: string; actor: string | null; details: Record<string, unknown> | null; createdAt: string }
export interface CandidateInterviewRowDto {
  id: number;
  meetingType: MeetingType;
  interviewType: InterviewType;
  startsAt: string;
  jobTitle: string;
  interviewerName: string | null;
  reviewerName: string | null;
  state: DisplayInterviewState;
  score: number | null;
  recommendation: Recommendation | null;
  feedback: string | null;
  liveNotes: string | null;
  roomCode: string | null;
}

export interface CandidateProfileDto {
  applicationId: number;
  candidateId: number;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  portfolioUrl: string | null;
  source: string;
  sourceLabel: string;
  rating: number;
  currentTitle: string | null;
  experienceLevel: ExperienceLevel | null;
  skills: string | null;
  education: string | null;
  candidateNotes: string | null;
  recordStatus: 'draft' | 'active';
  consentAt: string | null;
  candidateCreatedAt: string;
  stage: Stage;
  applicationStatus: 'active' | 'withdrawn';
  appliedAt: string;
  updatedAt: string;
  coverLetter: string | null;
  whyUs: string | null;
  job: { id: number; title: string; tags: string[]; location: string | null; employmentType: EmploymentType; department: string | null };
  assignedTo: { id: number; name: string } | null;
  otherApplications: Array<{ applicationId: number; jobTitle: string; stage: Stage; withdrawn: boolean }>;
  documents: DocumentDto[];
  legacyResumePath: string | null;
  resumeIndexed: boolean;
  notes: NoteDto[];
  feedback: FeedbackDto[];
  suggestions: SuggestionDto[];
  openRoles: Array<{ id: number; title: string }>;
  screeningReview: StageReviewDto | null;
  interviewReview: StageReviewDto | null;
  finalInterviewReview: StageReviewDto | null;
  aiAnalysis: AiAnalysisDto | null;
  interviews: CandidateInterviewRowDto[];
  activity: ActivityDto[];
  employee: { id: number; employeeNumber: string | null; jobTitle: string | null; department: string | null; startDate: string | null; status: EmployeeStatus } | null;
  departments: Array<{ id: number; name: string }>;
}

export const noteSchema = z.object({ note: z.string().trim().min(1, 'Write a note first.').max(5000) });
export const ratingSchema = z.object({ rating: z.number().int().min(0).max(5) });
export const feedbackSchema = z.object({ fit: z.enum(FEEDBACK_FITS), notes: z.string().trim().max(5000).optional().default('') });
export const suggestionSchema = z.object({ jobId: z.number().int().positive({ message: 'Choose a role.' }), note: z.string().trim().max(2000).optional().default('') });
export const stageReviewSchema = z.object({
  rating: z.number().int().min(0).max(100).nullable(),
  feedback: z.string().trim().max(5000).optional().default(''),
  notes: z.string().trim().max(5000).optional().default(''),
});
export const documentUploadSchema = z.object({ uploadId: z.string().uuid() });
export const convertEmployeeSchema = z.object({
  hiredPosition: z.string().trim().max(180).optional().default(''),
  employeeNumber: z.string().trim().max(40).optional().default(''),
  departmentId: z.number().int().positive().nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')).default(''),
});
export const profileUpdateSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required.').max(80),
  lastName: z.string().trim().max(80).default(''),
  email: z.string().trim().email('That email address is not valid.').transform((v) => v.toLowerCase()),
  phone: z.string().trim().max(50).optional().default(''),
  currentTitle: z.string().trim().max(160).optional().default(''),
  experienceLevel: z.enum(EXPERIENCE_LEVELS).nullable().optional(),
  skills: z.string().trim().max(500).optional().default(''),
  education: z.string().trim().max(300).optional().default(''),
  portfolioUrl: z.string().trim().max(255).optional().default(''),
});

const sourceKeys = Object.keys(MANUAL_SOURCES) as [keyof typeof MANUAL_SOURCES, ...Array<keyof typeof MANUAL_SOURCES>];

export const addCandidateSchema = z.object({
  action: z.enum(['submit', 'draft']).default('submit'),
  fullName: z.string().trim().max(160).default(''),
  email: z.string().trim().max(190).default(''),
  phone: z.string().trim().max(30).default(''),
  currentTitle: z.string().trim().max(160).default(''),
  experienceLevel: z.enum(['', ...EXPERIENCE_LEVELS]).default(''),
  skills: z.string().trim().max(500).default(''),
  education: z.string().trim().max(300).default(''),
  source: z.enum(sourceKeys).default('direct'),
  jobId: z.number().int().positive().nullable().default(null),
  notes: z.string().trim().max(5000).default(''),
  documentId: z.number().int().positive().nullable().default(null),
  resumeText: z.string().max(60000).default(''),
  cvParsed: z.boolean().default(false),
});
export type AddCandidateInput = z.input<typeof addCandidateSchema>;

export const requiredFieldsSchema = z.object({
  required: z.array(z.enum(Object.keys(CONFIGURABLE_CANDIDATE_FIELDS) as [keyof typeof CONFIGURABLE_CANDIDATE_FIELDS])),
});

export interface ParseCvResultDto {
  ok: boolean;
  code?: 'ERR_CORRUPT_FILE' | 'ERR_UNSUPPORTED_TYPE' | 'ERR_SIZE_EXCEEDED';
  message: string;
  document: { id: number; originalName: string; extension: string; sizeLabel: string };
  fields: Partial<Record<'full_name' | 'email' | 'phone' | 'current_title' | 'experience_level' | 'skills' | 'education', string>>;
  filled: string[];
  partial: boolean;
  resumeText: string;
}

export interface AddCandidateResultDto {
  candidateId: number;
  applicationId: number | null;
  draft: boolean;
}
