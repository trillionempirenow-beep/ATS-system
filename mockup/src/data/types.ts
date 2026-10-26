export const STAGES = ['new', 'screening', 'interview', 'final_interview', 'offer', 'hired', 'rejected'] as const;
export type Stage = (typeof STAGES)[number];

/** Forward order of the board. Rejected sits outside it. */
export const BOARD_STAGES = ['new', 'screening', 'interview', 'final_interview', 'offer', 'hired'] as const;
export type BoardStage = (typeof BOARD_STAGES)[number];

/** Not every role has a final round, so passing over it is never a skip. */
export const OPTIONAL_STAGES: ReadonlySet<Stage> = new Set<Stage>(['final_interview']);

export const STAGE_LABELS: Record<Stage, string> = {
  new: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  final_interview: 'Final interview',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Not selected',
};

export type Department = 'Engineering' | 'Design' | 'Product' | 'People' | 'Sales' | 'Operations';
export type WorkMode = 'Remote' | 'Hybrid' | 'On-site';
export type JobStatus = 'open' | 'pending' | 'draft' | 'closed';

export interface Job {
  id: string;
  title: string;
  department: Department;
  location: string;
  mode: WorkMode;
  type: 'Full-time' | 'Contract' | 'Internship';
  level: string;
  salary: string;
  status: JobStatus;
  postedAt: string;
  summary: string;
  responsibilities: string[];
  requirements: string[];
  skills: string[];
  hiringManager: string;
  featured?: boolean;
}

export interface Note {
  id: string;
  author: string;
  body: string;
  at: string;
}

export interface StageReview {
  stage: 'screening' | 'interview' | 'final_interview';
  reviewer: string;
  rating: 1 | 2 | 3 | 4 | 5;
  summary: string;
  at: string;
}

export interface HistoryEntry {
  stage: Stage;
  at: string;
}

export interface Candidate {
  id: string;
  ref: string;
  name: string;
  email: string;
  phone: string;
  location: string;
  headline: string;
  jobId: string;
  stage: Stage;
  source: 'Careers site' | 'Referral' | 'LinkedIn' | 'Job board' | 'Agency';
  appliedAt: string;
  stageChangedAt: string;
  match: number;
  skills: string[];
  experience: { company: string; role: string; years: string }[];
  education: string;
  links: { label: string; url: string }[];
  coverNote: string;
  notes: Note[];
  reviews: StageReview[];
  history: HistoryEntry[];
  withdrawn?: boolean;
  starred?: boolean;
}

export interface Interview {
  id: string;
  candidateId: string;
  title: string;
  stage: 'screening' | 'interview' | 'final_interview';
  at: string;
  minutes: number;
  mode: 'Acme Room' | 'External link' | 'On-site';
  panel: string[];
}

export interface Activity {
  id: string;
  who: string;
  text: string;
  at: string;
  kind: 'move' | 'note' | 'apply' | 'interview' | 'job';
}

export interface Teammate {
  name: string;
  role: string;
  email: string;
}
