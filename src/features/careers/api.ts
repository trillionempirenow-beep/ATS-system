import { useQuery } from '@tanstack/react-query';
import type { PublicHomeDto, PublicJobDetailDto, PublicJobsDto } from '@shared/api/public';
import { api, qs } from '@/lib/api';

export function usePublicHome() {
  return useQuery({ queryKey: ['public', 'home'], queryFn: () => api.get<PublicHomeDto>('/public/home') });
}

export function usePublicJobs(filters: { q?: string; dept?: string; loc?: string; tag?: string; urgent?: string }) {
  return useQuery({
    queryKey: ['public', 'jobs', filters],
    queryFn: () => api.get<PublicJobsDto>(`/public/jobs${qs(filters)}`),
    placeholderData: (prev) => prev,
  });
}

export function usePublicJob(slug: string) {
  return useQuery({ queryKey: ['public', 'job', slug], queryFn: () => api.get<PublicJobDetailDto>(`/public/jobs/${encodeURIComponent(slug)}`) });
}
