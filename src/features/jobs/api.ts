import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApprovalDecisionInput, ApprovalDetailDto, ApprovalQueueDto, JobEditorDto, JobsOverviewDto, MyJobsDto, SaveJobInput,
} from '@shared/api/jobs';
import type { JobStatus } from '@shared/domain/jobs';
import { api } from '@/lib/api';
import { notificationKeys } from '../notifications/api';

export const jobKeys = {
  all: ['jobs'] as const,
  overview: ['jobs', 'overview'] as const,
  mine: ['jobs', 'mine'] as const,
  editor: (id: number | null) => ['jobs', 'editor', id ?? 'new'] as const,
  approvals: ['jobs', 'approvals'] as const,
  approval: (id: number) => ['jobs', 'approval', id] as const,
};

export const useJobsOverview = () => useQuery({ queryKey: jobKeys.overview, queryFn: () => api.get<JobsOverviewDto>('/jobs') });
export const useMyJobs = () => useQuery({ queryKey: jobKeys.mine, queryFn: () => api.get<MyJobsDto>('/jobs/mine') });
export const useJobEditor = (id: number | null) =>
  useQuery({ queryKey: jobKeys.editor(id), queryFn: () => api.get<JobEditorDto>(id === null ? '/jobs/new' : `/jobs/${id}`) });
export const useApprovalQueue = () => useQuery({ queryKey: jobKeys.approvals, queryFn: () => api.get<ApprovalQueueDto>('/approvals') });
export const useApprovalDetail = (id: number) => useQuery({ queryKey: jobKeys.approval(id), queryFn: () => api.get<ApprovalDetailDto>(`/approvals/${id}`) });

function useInvalidateJobs() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: jobKeys.all });
    void qc.invalidateQueries({ queryKey: notificationKeys.shell });
    void qc.invalidateQueries({ queryKey: ['public'] });
  };
}

export function useSaveJob(id: number | null) {
  const invalidate = useInvalidateJobs();
  return useMutation({
    mutationFn: (input: SaveJobInput) => (id === null
      ? api.post<{ jobId: number; state: string }>('/jobs', input)
      : api.put<{ jobId: number; state: string }>(`/jobs/${id}`, input)),
    onSuccess: invalidate,
  });
}

export function useJobStatus() {
  const invalidate = useInvalidateJobs();
  return useMutation({ mutationFn: ({ id, status }: { id: number; status: JobStatus }) => api.patch(`/jobs/${id}/status`, { status }), onSuccess: invalidate });
}

export function useQuickEdit(id: number) {
  const invalidate = useInvalidateJobs();
  return useMutation({
    mutationFn: (input: { tags?: string; applicantLimit?: number | null; description?: string; requirements?: string; isUrgent?: boolean }) => api.patch(`/jobs/${id}`, input),
    onSuccess: invalidate,
  });
}

export function useCreateDepartment() {
  const invalidate = useInvalidateJobs();
  return useMutation({ mutationFn: (input: { name: string; description: string }) => api.post<{ id: number }>('/departments', input), onSuccess: invalidate });
}

export function useDecide(id: number) {
  const invalidate = useInvalidateJobs();
  return useMutation({ mutationFn: (input: ApprovalDecisionInput) => api.post<{ published: boolean }>(`/approvals/${id}/decision`, input), onSuccess: invalidate });
}
