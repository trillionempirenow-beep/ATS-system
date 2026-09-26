/**
 * Events the ATS can hand to n8n. Payloads carry ids and display values only —
 * never password hashes, reset tokens or candidate interview tokens.
 * `emailSentByApp` tells a workflow the ATS already emailed the person, so the
 * workflow does not send a duplicate.
 */
export interface N8nEventMap {
  'application.submitted': { applicationId: number; candidateId: number; jobId: number; jobTitle: string; candidateName: string; candidateEmail: string; source: string; emailSentByApp: boolean };
  'application.withdrawn': { applicationId: number; previousStage: string };
  'application.stage_changed': { applicationId: number; from: string; to: string; override: boolean; actorId: number; emailSentByApp: boolean };
  'candidate.created': { candidateId: number; applicationId: number | null; source: string; actorId: number };
  'candidate.hired_to_employee': { applicationId: number; employeeId: number; employeeNumber: string };
  'interview.scheduled': { interviewId: number; applicationId: number; startsAt: string; meetingType: string; interviewType: string; builtInRoom: boolean; interviewerId: number | null; emailSentByApp: boolean };
  'interview.updated': { interviewId: number; status: string; startsAt: string; emailSentByApp: boolean };
  'interview.candidate_waiting': { interviewId: number; interviewerId: number | null };
  'interview.started': { interviewId: number };
  'interview.ended': { interviewId: number };
  'interview.reviewed': { interviewId: number; applicationId: number; score: number | null; recommendation: string | null };
  'job.submitted': { jobId: number; title: string; submittedBy: number };
  'job.decided': { jobId: number; title: string; decision: string; published: boolean };
  'job.status_changed': { jobId: number; title: string; status: string };
  'referral.created': { referralId: number; jobId: number | null };
  'account.created': { userId: number; role: string; status: string };
  'account.status_changed': { userId: number; status: string };
  'password_reset.requested': { requestId: number; userId: number };
}

export type N8nEventName = keyof N8nEventMap;
