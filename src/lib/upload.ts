import type { UploadPurpose, UploadTicketDto } from '@shared/api/uploads';
import { uploadProblem } from '@shared/api/uploads';
import { api, ApiError } from './api';

/**
 * Two steps: the API issues a short-lived signed URL, then the browser sends the
 * file straight to storage (so large resumes never pass through the serverless
 * function). The returned uploadId is what forms submit; the API verifies the
 * file's real type and size when it is used.
 */
export async function uploadFile(purpose: UploadPurpose, file: File, onProgress?: (pct: number) => void): Promise<string> {
  const problem = uploadProblem(purpose, file);
  if (problem) throw new ApiError(415, 'unsupported_type', problem);
  const ticket = await api.post<UploadTicketDto>('/uploads', { purpose, fileName: file.name, size: file.size, contentType: file.type || 'application/octet-stream' });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(ticket.method, ticket.url);
    for (const [k, v] of Object.entries(ticket.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, 'service_unavailable', 'The upload did not finish. Please try again.')));
    xhr.onerror = () => reject(new ApiError(0, 'service_unavailable', 'The upload did not finish. Check your connection and try again.'));
    xhr.send(file);
  });
  onProgress?.(100);
  return ticket.uploadId;
}
