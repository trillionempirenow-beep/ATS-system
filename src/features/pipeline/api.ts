import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PipelineDto, StageMoveInput, StageMoveResultDto } from '@shared/api/pipeline';
import { api, qs } from '@/lib/api';

export function usePipeline(filters: { q?: string; job?: string; dept?: string }) {
  return useQuery({
    queryKey: ['pipeline', filters],
    queryFn: () => api.get<PipelineDto>(`/pipeline${qs(filters)}`),
    placeholderData: (prev) => prev,
  });
}

export function useMoveStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ applicationId, ...input }: StageMoveInput & { applicationId: number }) =>
      api.post<StageMoveResultDto>(`/applications/${applicationId}/stage`, input),
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: ['pipeline'] });
      void qc.invalidateQueries({ queryKey: ['candidates'] });
      void qc.invalidateQueries({ queryKey: ['candidate', v.applicationId] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
