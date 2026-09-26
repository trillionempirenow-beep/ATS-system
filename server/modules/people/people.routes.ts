import { Router, type Request } from 'express';
import { z } from 'zod';
import { attendanceReviewQuerySchema, attendanceStatusSchema, createEmployeeSchema, updateEmployeeSchema } from '../../../shared/api/people.js';
import { roleAllowed } from '../../../shared/domain/access.js';
import { audit } from '../../core/audit.js';
import { forbidden } from '../../http/errors.js';
import { body, idParam, parse, query } from '../../http/validate.js';
import { requireAuth, requireRoles, requireStaff } from '../../middleware/guards.js';
import * as service from './people.service.js';
import { UTF8_BOM } from '../../lib/format.js';

export const peopleRouter = Router();

const ctx = (req: Request) => ({ user: req.auth!.user, ip: req.ip ?? null });
const ok = { data: { ok: true } };
const reviewers = requireRoles('admin', 'hiring_manager');

peopleRouter.get('/employees', requireStaff, async (_req, res) => { res.json({ data: await service.employees() }); });
peopleRouter.post('/employees', requireStaff, async (req, res) => {
  res.status(201).json({ data: await service.createEmployee(body(req, createEmployeeSchema), ctx(req)) });
});
peopleRouter.patch('/employees/:id', requireStaff, async (req, res) => {
  await service.updateEmployee(idParam(req), body(req, updateEmployeeSchema), ctx(req));
  res.json(ok);
});

peopleRouter.get('/attendance/me', requireAuth, async (req, res) => { res.json({ data: await service.myAttendance(req.auth!.user) }); });
peopleRouter.post('/attendance/clock-in', requireAuth, async (req, res) => { await service.clockIn(ctx(req)); res.json(ok); });
peopleRouter.post('/attendance/clock-out', requireAuth, async (req, res) => { await service.clockOut(ctx(req)); res.json(ok); });

peopleRouter.get('/attendance/export', requireAuth, async (req, res) => {
  const q = parse(z.object({ scope: z.enum(['me', 'team']).default('me'), from: z.string().optional(), to: z.string().optional() }), req.query);
  if (q.scope === 'team' && !roleAllowed(req.auth!.user, ['admin', 'hiring_manager'])) throw forbidden('Team attendance is limited to Admins and Hiring Managers.');
  const csv = await service.exportCsv(q.scope, req.auth!.user, q.from, q.to);
  await audit({ userId: req.auth!.user.id, action: 'attendance_export', entityType: 'attendance', details: { scope: q.scope }, ip: req.ip ?? null });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename=attendance-${q.scope}-${new Date().toISOString().slice(0, 10)}.csv`);
  res.send(`${UTF8_BOM}${csv}`);
});

peopleRouter.get('/attendance', reviewers, async (req, res) => {
  const q = query(req, attendanceReviewQuerySchema);
  res.json({ data: await service.review(q.from, q.to) });
});
peopleRouter.patch('/attendance/:id', reviewers, async (req, res) => {
  await service.setAttendanceStatus(idParam(req), body(req, attendanceStatusSchema), ctx(req));
  res.json(ok);
});
