import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import express, { Router } from 'express';
import { createUploadSchema } from '../../../shared/api/uploads.js';
import { env } from '../../config/env.js';
import { sql } from '../../db/client.js';
import { auditQuietly } from '../../core/audit.js';
import { body, idParam } from '../../http/validate.js';
import { AppError, notFound } from '../../http/errors.js';
import { requireAuth, requireStaff } from '../../middleware/guards.js';
import { rateLimit } from '../../middleware/security.js';
import { BUCKETS, localStorageFile, storage, verifyLocalGrant } from '../../storage/storage.js';
import { createUploadTicket } from './uploads.service.js';

export const uploadsRouter = Router();

uploadsRouter.post(
  '/uploads',
  rateLimit({ name: 'upload-ticket', max: 30, windowSeconds: 600 }),
  async (req, res) => {
    const input = body(req, createUploadSchema);
    const ticket = await createUploadTicket(input, req.auth?.user ?? null);
    res.status(201).json({ data: ticket });
  },
);

/** GET /api/v1/media/users/:id/photo — any signed-in user. */
uploadsRouter.get('/media/users/:id/photo', requireAuth, async (req, res) => {
  const [row] = await sql<{ profile_image: string | null }[]>`select profile_image from users where id = ${idParam(req)}`;
  if (!row?.profile_image) throw notFound('No photo.');
  res.set('Cache-Control', 'private, max-age=240');
  res.redirect(302, await storage.signedUrl(BUCKETS.photos, row.profile_image, { expiresIn: 300 }));
});

/** GET /api/v1/media/candidates/:id/photo — hiring staff only. */
uploadsRouter.get('/media/candidates/:id/photo', requireStaff, async (req, res) => {
  const [row] = await sql<{ profile_image: string | null }[]>`select profile_image from candidates where id = ${idParam(req)}`;
  if (!row?.profile_image) throw notFound('No photo.');
  res.set('Cache-Control', 'private, max-age=240');
  res.redirect(302, await storage.signedUrl(BUCKETS.photos, row.profile_image, { expiresIn: 300 }));
});

/** Replaces download.php: access check, audit, then a 60-second signed link. */
uploadsRouter.get('/documents/:id/download', requireStaff, async (req, res) => {
  const [doc] = await sql<{ id: number; candidate_id: number | null; storage_path: string; original_name: string; extension: string }[]>`
    select id, candidate_id, storage_path, original_name, extension from candidate_documents where id = ${idParam(req)}`;
  if (!doc) throw notFound('That document does not exist.');
  const inline = req.query.inline === '1' && doc.extension === 'pdf';
  await auditQuietly({
    userId: req.auth!.user.id, action: 'document_downloaded', entityType: 'candidate', entityId: doc.candidate_id,
    details: { file: doc.original_name, mode: inline ? 'viewed' : 'downloaded' }, ip: req.ip ?? null,
  });
  const url = await storage.signedUrl(BUCKETS.resumes, doc.storage_path, {
    expiresIn: 60,
    ...(inline ? {} : { downloadName: doc.original_name }),
  });
  if (req.query.format === 'json') {
    res.json({ data: { url } });
    return;
  }
  res.redirect(302, url);
});

/** Staff can open the source PDF a posting was imported from. */
uploadsRouter.get('/jobs/:id/source-pdf', requireStaff, async (req, res) => {
  const [job] = await sql<{ source_pdf: string | null; title: string }[]>`select source_pdf, title from jobs where id = ${idParam(req)}`;
  if (!job?.source_pdf) throw notFound('This posting has no source PDF.');
  res.redirect(302, await storage.signedUrl(BUCKETS.jobDocuments, job.source_pdf, { expiresIn: 60 }));
});

// Development-only endpoints backing the local storage driver.
if (env.STORAGE_DRIVER === 'local') {
  uploadsRouter.put('/uploads/local/:token', express.raw({ type: '*/*', limit: '12mb' }), async (req, res) => {
    const grant = verifyLocalGrant(String(req.params.token), 'put');
    if (!grant) throw new AppError(403, 'forbidden', 'Upload link expired.');
    const file = localStorageFile(grant.b, grant.p);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, req.body as Buffer);
    res.json({ Key: `${grant.b}/${grant.p}` });
  });
  uploadsRouter.get('/uploads/local/:token', async (req, res) => {
    const grant = verifyLocalGrant(String(req.params.token), 'get');
    if (!grant) throw new AppError(403, 'forbidden', 'Link expired.');
    const data = await readFile(localStorageFile(grant.b, grant.p)).catch(() => null);
    if (!data) throw notFound();
    const ext = path.extname(grant.p).slice(1);
    const types: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    res.set('Content-Type', types[ext] ?? 'application/octet-stream');
    res.set('Content-Security-Policy', 'sandbox');
    if (grant.n) res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(grant.n)}`);
    res.send(data);
  });
}
