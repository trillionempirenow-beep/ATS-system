import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DeliveryReport } from '@shared/api/envelope';
import type {
  InterviewListDto, ReviewInput, ScheduleInterviewInput, ScheduleOptionsDto, ScheduleResultDto, StaffRoomDto, UpdateInterviewInput,
} from '@shared/api/interviews';
import { api } from '@/lib/api';

export const interviewKeys = {
  list: ['interviews'] as const,
  options: ['interview-options'] as const,
  detail: (id: number) => ['interview', id] as const,
};

export function useInterviews() {
  return useQuery({ queryKey: interviewKeys.list, queryFn: () => api.get<InterviewListDto>('/interviews'), refetchInterval: 60_000 });
}

export function useScheduleOptions(enabled: boolean) {
  return useQuery({ queryKey: interviewKeys.options, queryFn: () => api.get<ScheduleOptionsDto>('/interviews/options'), enabled });
}

export function useInterview(id: number) {
  return useQuery({ queryKey: interviewKeys.detail(id), queryFn: () => api.get<StaffRoomDto>(`/interviews/${id}`) });
}

function useInvalidateInterviews() {
  const qc = useQueryClient();
  return (id?: number) => {
    void qc.invalidateQueries({ queryKey: interviewKeys.list });
    void qc.invalidateQueries({ queryKey: interviewKeys.options });
    void qc.invalidateQueries({ queryKey: ['candidate'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    if (id) void qc.invalidateQueries({ queryKey: interviewKeys.detail(id) });
  };
}

export function useScheduleInterview() {
  const invalidate = useInvalidateInterviews();
  return useMutation({
    mutationFn: (input: ScheduleInterviewInput) => api.post<ScheduleResultDto>('/interviews', input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateInterview(id: number) {
  const invalidate = useInvalidateInterviews();
  return useMutation({
    mutationFn: (input: UpdateInterviewInput) => api.patch<DeliveryReport>(`/interviews/${id}`, input),
    onSuccess: () => invalidate(id),
  });
}

export function useSubmitReview(id: number) {
  const invalidate = useInvalidateInterviews();
  return useMutation({
    mutationFn: (input: ReviewInput) => api.post(`/interviews/${id}/review`, input),
    onSuccess: () => invalidate(id),
  });
}

export function useSaveScorecard(id: number) {
  return useMutation({
    mutationFn: (ratings: Record<string, number | null>) => api.put(`/interviews/${id}/scorecard/draft`, { ratings }),
  });
}
