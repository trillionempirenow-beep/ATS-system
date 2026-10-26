import { Router, type Request } from 'express';
import { createShareSchema, libraryListQuerySchema, shareCodeRequestSchema, shareCodeVerifySchema } from '../../../shared/api/library.js';
import { body, idParam, query } from '../../http/validate.js';
import { requirePermission } from '../../middleware/guards.js';
import { rateLimit } from '../../middleware/security.js';
import * as service from './library.service.js';

export const libraryRouter = Router();

const ctx = (req: Request) => ({ user: req.auth!.user, ip: req.ip ?? null });
const library = requirePermission('library');

// ---- Staff with the Library permission -------------------------------------

libraryRouter.get('/library', library, async (req, res) => {
  res.json({ data: await service.list(query(req, libraryListQuerySchema)) });
});

libraryRouter.get('/library/:id', library, async (req, res) => {
  res.json({ data: await service.detail(idParam(req), ctx(req)) });
});

libraryRouter.get('/library/:id/documents/:docId', library, async (req, res) => {
  res.json({ data: await service.staffDocument(idParam(req), idParam(req, 'docId'), req.query.download === '1', ctx(req)) });
});

libraryRouter.get('/library/:id/recordings/:recId', library, async (req, res) => {
  res.json({ data: await service.staffRecording(idParam(req), idParam(req, 'recId')) });
});

const shareLimit = rateLimit({ name: 'library-share', max: 30, windowSeconds: 3600, key: (req) => String(req.auth?.user.id ?? req.ip) });

libraryRouter.post('/library/:id/shares', library, shareLimit, async (req, res) => {
  res.status(201).json({ data: await service.createShare(idParam(req), body(req, createShareSchema), ctx(req)) });
});

libraryRouter.post('/library/shares/:id/revoke', library, async (req, res) => {
  res.json({ data: await service.revokeShare(idParam(req), ctx(req)) });
});

// ---- The person a file was shared with (no account) ------------------------

const token = (req: Request) => String(req.params.token ?? '');
const viewer = (req: Request) => req.get('x-share-viewer') ?? undefined;
const codeLimit = rateLimit({ name: 'share-code', max: 5, windowSeconds: 900, key: (req) => `${req.ip}:${String(req.params.token ?? '').slice(0, 12)}` });
const verifyLimit = rateLimit({ name: 'share-verify', max: 10, windowSeconds: 900, key: (req) => `${req.ip}:${String(req.params.token ?? '').slice(0, 12)}` });

libraryRouter.get('/shared/:token', async (req, res) => {
  res.json({ data: await service.landing(token(req)) });
});

libraryRouter.post('/shared/:token/code', codeLimit, async (req, res) => {
  res.json({ data: await service.requestCode(token(req), body(req, shareCodeRequestSchema).email, req.ip ?? null) });
});

libraryRouter.post('/shared/:token/verify', verifyLimit, async (req, res) => {
  const b = body(req, shareCodeVerifySchema);
  res.json({ data: await service.verifyCode(token(req), b.email, b.code, req.ip ?? null) });
});

libraryRouter.get('/shared/:token/file', async (req, res) => {
  res.json({ data: await service.sharedFile(token(req), viewer(req), req.ip ?? null) });
});

libraryRouter.get('/shared/:token/documents/:docId', async (req, res) => {
  res.json({ data: await service.sharedDocument(token(req), viewer(req), idParam(req, 'docId'), req.query.download === '1', req.ip ?? null) });
});

libraryRouter.get('/shared/:token/recordings/:recId', async (req, res) => {
  res.json({ data: await service.sharedRecording(token(req), viewer(req), idParam(req, 'recId'), req.ip ?? null) });
});
