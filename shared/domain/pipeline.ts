export const STAGES = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const;
export type Stage = (typeof STAGES)[number];

/** Forward order used for skip detection; rejected sits outside it. */
export const STAGE_ORDER = ['new', 'screening', 'interview', 'offer', 'hired'] as const;
export type BoardStage = (typeof STAGE_ORDER)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  new: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Rejected',
};

export type Tone = 'info' | 'success' | 'warning' | 'danger' | 'teal' | 'purple' | 'neutral';

export const STAGE_TONES: Record<Stage, Tone> = {
  new: 'info',
  screening: 'warning',
  interview: 'teal',
  offer: 'purple',
  hired: 'success',
  rejected: 'danger',
};

export const APPLICATION_STATUSES = ['active', 'withdrawn'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export function stageRank(stage: Stage): number {
  return (STAGE_ORDER as readonly Stage[]).indexOf(stage);
}

/** Moving forward past the next stage. Rejecting or moving backward is never a skip. */
export function isStageSkip(from: Stage, to: Stage): boolean {
  if (to === 'rejected') return false;
  const f = stageRank(from);
  const t = stageRank(to);
  return f !== -1 && t !== -1 && t > f + 1;
}

export type MoveKind = 'forward' | 'skip' | 'backward' | 'reject' | 'same';

export function classifyMove(from: Stage, to: Stage): MoveKind {
  if (from === to) return 'same';
  if (to === 'rejected') return 'reject';
  if (isStageSkip(from, to)) return 'skip';
  const f = stageRank(from);
  const t = stageRank(to);
  if (f === -1) return 'forward';
  return t > f ? 'forward' : 'backward';
}

const TRANSITION_MESSAGES: Record<string, string> = {
  'new>screening': "You're moving this candidate into Screening. Make sure their application and resume have been reviewed.",
  'screening>interview': "You're moving this candidate into Interview. Review their screening results before proceeding.",
  'interview>offer': "You're moving this candidate to Offer. Confirm that interview feedback and scorecards are complete.",
  'offer>hired': "You're marking this candidate as Hired. You'll be able to add them to Employees from their profile.",
  'new>interview': 'This skips the Screening stage.',
  'new>offer': 'This skips Screening and Interview.',
  'new>hired': 'This skips Screening, Interview, and Offer.',
  'screening>offer': 'This skips the Interview stage.',
  'screening>hired': 'This skips Interview and Offer.',
  'interview>hired': 'This skips the Offer stage.',
};

export function transitionMessage(from: Stage, to: Stage): string {
  return (
    TRANSITION_MESSAGES[`${from}>${to}`] ??
    (to === 'rejected'
      ? 'The application is closed and the applicant will see that they are not moving forward.'
      : `You're moving this candidate from ${STAGE_LABELS[from]} to ${STAGE_LABELS[to]}.`)
  );
}

export const SKIP_BLOCKED_MESSAGE = 'This candidate cannot skip stages. Complete the required recruitment stages first.';

export const FEEDBACK_FITS = ['strong-fit', 'potential-fit', 'not-a-fit'] as const;
export type FeedbackFit = (typeof FEEDBACK_FITS)[number];
export const FEEDBACK_FIT_LABELS: Record<FeedbackFit, string> = {
  'strong-fit': 'Strong fit',
  'potential-fit': 'Potential fit',
  'not-a-fit': 'Not a fit',
};

export const EXPERIENCE_LEVELS = ['entry', 'mid', 'senior', 'lead'] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];
export const EXPERIENCE_LEVEL_LABELS: Record<ExperienceLevel, string> = {
  entry: 'Entry level',
  mid: 'Mid level',
  senior: 'Senior',
  lead: 'Lead / Principal',
};

/** Sources offered on the internal Add candidate form. */
export const MANUAL_SOURCES = {
  career_site: 'Career site',
  linkedin: 'LinkedIn',
  referral: 'Referral',
  direct: 'Direct approach',
  agency: 'Agency',
  job_board: 'Job board',
  event: 'Event / careers fair',
  other: 'Other',
} as const;
export type ManualSource = keyof typeof MANUAL_SOURCES;

/** "How did you hear about us" on the public application form. */
export const APPLY_SOURCES = {
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  indeed: 'Indeed',
  jobstreet: 'JobStreet',
  company_website: 'Company Website',
  google: 'Google Search',
  referral: 'Friend or Colleague',
  agency: 'Recruitment Agency',
  university: 'University / School',
  job_fair: 'Job Fair',
  other: 'Other',
} as const;
export type ApplySource = keyof typeof APPLY_SOURCES;

export function sourceLabel(source: string | null | undefined): string {
  if (!source) return '—';
  if (source.startsWith('Other: ')) return source;
  const all: Record<string, string> = { ...MANUAL_SOURCES, ...APPLY_SOURCES };
  return all[source] ?? source.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Fields an Admin can make mandatory on Add candidate (name and email always are). */
export const CONFIGURABLE_CANDIDATE_FIELDS = {
  phone: 'Phone number',
  current_title: 'Current role',
  experience_level: 'Experience level',
  skills: 'Skills',
  education: 'Education',
  source: 'Source',
  job_id: 'Target position',
} as const;
export type ConfigurableCandidateField = keyof typeof CONFIGURABLE_CANDIDATE_FIELDS;
