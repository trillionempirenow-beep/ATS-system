import type { z } from 'zod';
import type { RecordingGrantDto, recordingSaveSchema } from '../../../shared/api/interviews.js';
import { sql } from '../../db/client.js';
import { audit } from '../../core/audit.js';
import { AppError, conflict, forbidden } from '../../http/errors.js';
import { hmac, randomHex, safeEqual } from '../../lib/crypto.js';
import { BUCKETS, storage } from '../../storage/storage.js';
import * as repo from './interviews.repository.js';

/**
 * Meeting recordings. The interviewer's browser draws the camera tiles and
 * mixes the sound, and uploads the meeting in five-minute parts straight to
 * storage; the server only hands out upload slots and keeps the list.
 */

async function recorderRow(id: number, userId: number) {
  const row = await repo.byId(id);
  if (!row) throw new AppError(404, 'not_found', 'Could not find that meeting.');
  if (row.interviewer_id !== userId) throw forbidden('Only the interviewer records this meeting.');
  if (!row.record_meeting) throw conflict('This meeting is not set to be recorded.');
  // The last part arrives just after the meeting ends, so only a cancelled meeting refuses it.
  if (row.status === 'cancelled') throw conflict('This meeting was cancelled.');
  return row;
}

const pathToken = (id: number, path: string) => hmac(`recording:${id}:${path}`);

export async function partCount(id: number): Promise<number> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from interview_recordings where interview_id = ${id}`;
  return r?.n ?? 0;
}

/** A one-time upload slot for the next part. */
export async function grant(id: number, userId: number, mime: string): Promise<RecordingGrantDto> {
  await recorderRow(id, userId);
  const path = `${id}/${Date.now()}-${randomHex(6)}.${mime === 'video/mp4' ? 'mp4' : 'webm'}`;
  const signed = await storage.signedUpload(BUCKETS.recordings, path, mime);
  return { path, uploadUrl: signed.url, headers: signed.headers, token: pathToken(id, path) };
}

/** The part is uploaded: add it to the meeting's recording. */
export async function save(id: number, userId: number, input: z.infer<typeof recordingSaveSchema>): Promise<{ parts: number }> {
  await recorderRow(id, userId);
  if (!input.path.startsWith(`${id}/`) || !safeEqual(input.token, pathToken(id, input.path))) throw forbidden('That upload slot is not valid.');
  const [row] = await sql<{ id: number }[]>`
    insert into interview_recordings (interview_id, seq, storage_path, mime_type, size_bytes, duration_sec, started_at)
    select ${id}, coalesce(max(seq) + 1, 0), ${input.path}, ${input.mime}, ${input.sizeBytes}, ${input.durationSec}, ${input.startedAt}
    from interview_recordings where interview_id = ${id}
    on conflict do nothing
    returning id`;
  if (row) {
    await audit({ userId, action: 'interview_recording_part', entityType: 'interview', entityId: id, details: { seconds: input.durationSec, bytes: input.sizeBytes } });
  }
  return { parts: await partCount(id) };
}

/** Housekeeping: recordings go once their meeting is older than the retention period. */
export async function cleanup(days: number): Promise<number> {
  const old = await sql<{ id: number; storage_path: string }[]>`
    select r.id, r.storage_path from interview_recordings r join interviews i on i.id = r.interview_id
    where i.starts_at < now() - make_interval(days => ${days}) order by r.id limit 200`;
  if (!old.length) return 0;
  await storage.remove(BUCKETS.recordings, old.map((r) => r.storage_path));
  await sql`delete from interview_recordings where id in ${sql(old.map((r) => r.id))}`;
  return old.length;
}
