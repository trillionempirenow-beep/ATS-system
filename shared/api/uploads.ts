import { z } from 'zod';

export const UPLOAD_RULES = {
  resume: { maxBytes: 10 * 1024 * 1024, extensions: ['pdf', 'doc', 'docx'], label: 'PDF, DOC or DOCX, up to 10 MB' },
  candidate_photo: { maxBytes: 3 * 1024 * 1024, extensions: ['jpg', 'jpeg', 'png', 'webp'], label: 'JPG, PNG or WEBP, up to 3 MB' },
  user_photo: { maxBytes: 3 * 1024 * 1024, extensions: ['jpg', 'jpeg', 'png', 'webp'], label: 'JPG, PNG or WEBP, up to 3 MB' },
  job_pdf: { maxBytes: 8 * 1024 * 1024, extensions: ['pdf'], label: 'PDF, up to 8 MB' },
} as const;
export type UploadPurpose = keyof typeof UPLOAD_RULES;

export const createUploadSchema = z.object({
  purpose: z.enum(['resume', 'candidate_photo', 'user_photo', 'job_pdf']),
  fileName: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  contentType: z.string().max(120).optional().default('application/octet-stream'),
});
export type CreateUploadInput = z.input<typeof createUploadSchema>;

export interface UploadTicketDto {
  uploadId: string;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export function fileExtension(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1]!.toLowerCase() : '';
}

/** Client-side pre-check with the same rules the server enforces. */
export function uploadProblem(purpose: UploadPurpose, file: { name: string; size: number }): string | null {
  const rule = UPLOAD_RULES[purpose];
  if (!(rule.extensions as readonly string[]).includes(fileExtension(file.name))) return `Upload failed: only ${rule.label.split(',')[0]} files are supported.`;
  if (file.size > rule.maxBytes) return `Upload failed: file exceeds the ${Math.round(rule.maxBytes / 1048576)} MB limit.`;
  return null;
}

export const formatBytes = (bytes: number): string =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
