import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateShareInput, CreateShareResultDto, LibraryDetailDto, LibraryListDto, LibraryShareDto, SharedFileDto, SharedLandingDto, ShareViewerDto,
} from '@shared/api/library';
import { api, qs } from '@/lib/api';

export const libraryKeys = {
  list: (f: object) => ['library', 'list', f] as const,
  file: (id: number) => ['library', 'file', id] as const,
};

export function useLibrary(filters: { q?: string; job?: string; stage?: string; has?: string; page?: string }) {
  return useQuery({ queryKey: libraryKeys.list(filters), queryFn: () => api.get<LibraryListDto>(`/library${qs(filters)}`), placeholderData: (prev) => prev });
}

export function useLibraryFile(id: number) {
  return useQuery({ queryKey: libraryKeys.file(id), queryFn: () => api.get<LibraryDetailDto>(`/library/${id}`) });
}

export function useCreateShare(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateShareInput) => api.post<CreateShareResultDto>(`/library/${id}/shares`, input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['library'] }); },
  });
}

export function useRevokeShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shareId: number) => api.post<LibraryShareDto>(`/library/shares/${shareId}/revoke`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['library'] }); },
  });
}

export const staffDocumentUrl = (id: number, docId: number, download: boolean) =>
  api.get<{ url: string }>(`/library/${id}/documents/${docId}${download ? '?download=1' : ''}`).then((r) => r.url);
export const staffRecordingUrl = (id: number, recId: number) => api.get<{ url: string }>(`/library/${id}/recordings/${recId}`).then((r) => r.url);

// ---- The recipient's side --------------------------------------------------

const viewerKey = (token: string) => `acme-share-viewer:${token}`;
export function readViewer(token: string): string | null {
  try {
    const raw = sessionStorage.getItem(viewerKey(token));
    if (!raw) return null;
    const v = JSON.parse(raw) as { t: string; e: string };
    return new Date(v.e).getTime() > Date.now() ? v.t : null;
  } catch { return null; }
}
export function saveViewer(token: string, v: ShareViewerDto | null) {
  try {
    if (v) sessionStorage.setItem(viewerKey(token), JSON.stringify({ t: v.viewerToken, e: v.expiresAt }));
    else sessionStorage.removeItem(viewerKey(token));
  } catch { /* private mode: the viewer signs in again on reload */ }
}

const withViewer = (viewer: string) => ({ 'X-Share-Viewer': viewer });
export const sharedApi = {
  landing: (token: string) => api.get<SharedLandingDto>(`/shared/${encodeURIComponent(token)}`),
  requestCode: (token: string, email: string) => api.post<{ sent: true }>(`/shared/${encodeURIComponent(token)}/code`, { email }),
  verify: (token: string, email: string, code: string) => api.post<ShareViewerDto>(`/shared/${encodeURIComponent(token)}/verify`, { email, code }),
  file: (token: string, viewer: string) => api.getWith<SharedFileDto>(`/shared/${encodeURIComponent(token)}/file`, withViewer(viewer)),
  documentUrl: (token: string, viewer: string, docId: number, download: boolean) =>
    api.getWith<{ url: string }>(`/shared/${encodeURIComponent(token)}/documents/${docId}${download ? '?download=1' : ''}`, withViewer(viewer)).then((r) => r.url),
  recordingUrl: (token: string, viewer: string, recId: number) =>
    api.getWith<{ url: string }>(`/shared/${encodeURIComponent(token)}/recordings/${recId}`, withViewer(viewer)).then((r) => r.url),
};
