import { Router, type Request } from 'express';
import { approvalDecisionSchema, departmentSchema, extractPdfSchema, jobStatusSchema, quickEditSchema, saveJobSchema } from '../../../shared/api/jobs.js';
import { sql } from '../../db/client.js';
import { body, idParam } from '../../http/validate.js';
import { requireAnyPermission, requireAuth, requireCanPublish, requirePermission, requireRoles } from '../../middleware/guards.js';
import * as service from './jobs.service.js';

export const jobsRouter = Router();

const ctx = (req: Request) => ({ user: req.auth!.user, ip: req.ip ?? null });
const jobManagement = [requireRoles('admin'), requirePermission('job_management')];
const jobEditors = requireAnyPermission('job_posting', 'job_management');

jobsRouter.get('/jobs', ...jobManagement, async (req, res) => {
  res.json({ data: await service.overview(req.auth!.user) });
});

jobsRouter.get('/jobs/mine', requirePermission('job_management'), async (req, res) => {
  res.json({ data: await service.mine(req.auth!.user) });
});

jobsRouter.get('/jobs/new', requirePermission('job_posting'), async (req, res) => {
  res.json({ data: await service.editor(null, req.auth!.user) });
});

jobsRouter.post('/jobs/extract-pdf', requirePermission('job_posting'), async (req, res) => {
  res.json({ data: await service.extractPdf(body(req, extractPdfSchema).uploadId, ctx(req)) });
});

jobsRouter.post('/jobs', requirePermission('job_posting'), async (req, res) => {
  res.status(201).json({ data: await service.save(null, body(req, saveJobSchema), ctx(req)) });
});

jobsRouter.get('/jobs/:id', jobEditors, async (req, res) => {
  res.json({ data: await service.editor(idParam(req), req.auth!.user) });
});

jobsRouter.put('/jobs/:id', jobEditors, async (req, res) => {
  res.json({ data: await service.save(idParam(req), body(req, saveJobSchema), ctx(req)) });
});

jobsRouter.post('/jobs/:id/submit', jobEditors, async (req, res) => {
  await service.submit(idParam(req), ctx(req));
  res.json({ data: { ok: true } });
});

jobsRouter.patch('/jobs/:id/status', ...jobManagement, async (req, res) => {
  await service.setStatus(idParam(req), body(req, jobStatusSchema), ctx(req));
  res.json({ data: { ok: true } });
});

jobsRouter.patch('/jobs/:id', ...jobManagement, async (req, res) => {
  await service.quickEdit(idParam(req), body(req, quickEditSchema), ctx(req));
  res.json({ data: { ok: true } });
});

jobsRouter.get('/departments', requireAuth, async (_req, res) => {
  res.json({ data: await sql<{ id: number; name: string }[]>`select id, name from departments order by name` });
});

jobsRouter.post('/departments', ...jobManagement, async (req, res) => {
  res.status(201).json({ data: await service.createDepartment(body(req, departmentSchema), ctx(req)) });
});

jobsRouter.get('/approvals', requireCanPublish, async (req, res) => {
  res.json({ data: await service.approvalQueue(req.auth!.user) });
});

jobsRouter.get('/approvals/:id', requireCanPublish, async (req, res) => {
  res.json({ data: await service.approvalDetail(idParam(req), req.auth!.user) });
});

jobsRouter.post('/approvals/:id/decision', requireCanPublish, async (req, res) => {
  res.json({ data: await service.decide(idParam(req), body(req, approvalDecisionSchema), ctx(req)) });
});
