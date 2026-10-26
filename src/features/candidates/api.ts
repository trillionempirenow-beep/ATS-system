import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CandidateListDto, CandidateProfileDto, RecordingsDto } from '@shared/api/candidates';
import { api, qs } from '@/lib/api';

export function useCandidates(filters: Record<string, string | undefined>) {
  return useQuery({
    queryKey: ['candidates', filters],
    queryFn: () => api.get<CandidateListDto>(`/candidates${qs(filters)}`),
    placeholderData: (prev) => prev,
  });
}

export function useCandidate(applicationId: number) {
  return useQuery({
    queryKey: ['candidate', applicationId],
    queryFn: () => api.get<CandidateProfileDto>(`/candidates/${applicationId}`),
  });
}

/** What was kept from this candidate's meetings (loaded only when the Recordings section is open). */
export function useRecordings(applicationId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['candidate', applicationId, 'recordings'],
    queryFn: () => api.get<RecordingsDto>(`/candidates/${applicationId}/recordings`),
    enabled,
  });
}

/** A write on the profile that refreshes the profile (and lists) afterwards. */
export function useCandidateAction<TInput>(applicationId: number, run: (input: TInput) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['candidate', applicationId] });
      void qc.invalidateQueries({ queryKey: ['candidates'] });
      void qc.invalidateQueries({ queryKey: ['pipeline'] });
    },
  });
}
