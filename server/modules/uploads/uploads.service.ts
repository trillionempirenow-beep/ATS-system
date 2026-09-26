import { randomUUID } from 'node:crypto';
import { UPLOAD_RULES, fileExtension, type CreateUploadInput, type UploadPurpose, type UploadTicketDto } from '../../../shared/api/uploads.js';
import { hasPermission } from '../../../shared/domain/access.js';
import { sql } from '../../db/client.js';
import { AppError, forbidden, unauthenticated, validationFailed } from '../../http/errors.js';
import type { CurrentUser } from '../../http/context.js';
import { BUCKETS, storage, type Bucket } from '../../storage/storage.js';

const BUCKET_FOR: Record<UploadPurpose, Bucket> = {
  resume: BUCKETS.resumes,
  candidate_photo: BUCKETS.photos,
  user_photo: BUCKETS.photos,
  job_pdf: BUCKETS.jobDocuments,
};

const MIME_FOR: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** The file's real type from its first bytes. The extension alone is never trusted. */
export function sniffType(buf: Buffer): 'pdf' | 'doc' | 'docx' | 'jpg' | 'png' | 'webp' | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return 'doc';
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'docx';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

function typeError(purpose: UploadPurpose): AppError {
  return new AppError(415, 'unsupported_type', `Upload failed: only ${UPLOAD_RULES[purpose].label.split(',')[0]} files are supported.`);
}

export async function createUploadTicket(input: CreateUploadInput & { contentType: string }, user: CurrentUser | null): Promise<UploadTicketDto> {
  const purpose = input.purpose;
  if (purpose === 'user_photo' && !user) throw unauthenticated();
  if (purpose === 'job_pdf') {
    if (!user) throw unauthenticated();
    if (!hasPermission(user, 'job_posting')) throw forbidden('Creating job postings requires the "Job posting" permission.');
  }
  const rule = UPLOAD_RULES[purpose];
  const ext = fileExtension(input.fileName);
  if (!(rule.extensions as readonly string[]).includes(ext)) throw typeError(purpose);
  if (input.size > rule.maxBytes) {
    throw new AppError(413, 'payload_too_large', `Upload failed: file exceeds the ${Math.round(rule.maxBytes / 1048576)} MB limit.`);
  }
  const id = randomUUID();
  const objectPath = `pending/${id}.${ext === 'jpeg' ? 'jpg' : ext}`;
  const mime = MIME_FOR[ext] ?? 'application/octet-stream';
  await sql`insert into pending_uploads (id, purpose, storage_path, original_name, declared_size, declared_mime, created_by, expires_at)
            values (${id}, ${purpose}, ${objectPath}, ${input.fileName.slice(0, 255)}, ${input.size}, ${mime}, ${user?.id ?? null}, now() + interval '1 hour')`;
  const signed = await storage.signedUpload(BUCKET_FOR[purpose], objectPath, mime);
  return { uploadId: id, ...signed };
}

export interface ConsumedUpload {
  bucket: Bucket;
  path: string;
  originalName: string;
  extension: 'pdf' | 'doc' | 'docx' | 'jpg' | 'png' | 'webp';
  mime: string;
  size: number;
  data: Buffer;
}

/**
 * Turns an uploaded file into a verified, permanently stored object. Checks
 * ownership, expiry, actual size and actual type, then moves it out of
 * pending/ to finalPrefix. Call once per upload; a second call fails.
 */
export async function consumeUpload(uploadId: string, purpose: UploadPurpose, user: CurrentUser | null, finalPrefix: string, field = 'file'): Promise<ConsumedUpload> {
  const [row] = await sql<{ id: string; purpose: UploadPurpose; storage_path: string; original_name: string; created_by: number | null; consumed_at: Date | null; expires_at: Date }[]>`
    select id, purpose, storage_path, original_name, created_by, consumed_at, expires_at from pending_uploads where id = ${uploadId}`;
  if (!row || row.purpose !== purpose || row.consumed_at || row.expires_at.getTime() < Date.now()) {
    throw validationFailed({ [field]: 'The uploaded file has expired. Please attach it again.' });
  }
  if (row.created_by !== null && row.created_by !== user?.id) throw forbidden('That upload belongs to someone else.');

  const bucket = BUCKET_FOR[purpose];
  const data = await storage.download(bucket, row.storage_path);
  if (!data) throw validationFailed({ [field]: 'We could not receive that file. Please try again.' });
  const rule = UPLOAD_RULES[purpose];
  if (data.length > rule.maxBytes) {
    await storage.remove(bucket, [row.storage_path]);
    throw new AppError(413, 'payload_too_large', `Upload failed: file exceeds the ${Math.round(rule.maxBytes / 1048576)} MB limit.`);
  }
  const sniffed = sniffType(data);
  const declaredExt = fileExtension(row.original_name).replace('jpeg', 'jpg');
  if (!sniffed || sniffed !== declaredExt || !(rule.extensions as readonly string[]).includes(sniffed)) {
    await storage.remove(bucket, [row.storage_path]);
    throw typeError(purpose);
  }

  const finalPath = `${finalPrefix.replace(/\/$/, '')}/${row.id}.${sniffed}`;
  await storage.move(bucket, row.storage_path, finalPath);
  await sql`update pending_uploads set consumed_at = now(), storage_path = ${finalPath} where id = ${row.id}`;
  return { bucket, path: finalPath, originalName: row.original_name, extension: sniffed, mime: MIME_FOR[sniffed] ?? 'application/octet-stream', size: data.length, data };
}

/** Housekeeping for uploads that were never used (called by the cron route). */
export async function pruneExpiredUploads(): Promise<number> {
  const rows = await sql<{ id: string; purpose: UploadPurpose; storage_path: string }[]>`
    select id, purpose, storage_path from pending_uploads where consumed_at is null and expires_at < now() limit 200`;
  for (const r of rows) {
    await storage.remove(BUCKET_FOR[r.purpose], [r.storage_path]).catch(() => undefined);
    await sql`delete from pending_uploads where id = ${r.id}`;
  }
  return rows.length;
}
