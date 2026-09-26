import { Router, type Request } from 'express';
import {
  accountStatusSchema, adminPermissionsSchema, auditQuerySchema, createAdminSchema, createHrSchema, decisionSchema, hrAccountsQuerySchema,
  hrPermissionsSchema, portalApplicationStatusSchema, portalJobVisibilitySchema, portalSettingsSchema, reactivationSchema, settingsSchema,
} from '../../../shared/api/admin.js';
import { audit } from '../../core/audit.js';
import { body, idParam, query } from '../../http/validate.js';
import { requireAdminLevel, requirePermission, requireSuperAdmin } from '../../middleware/guards.js';
import * as accounts from './accounts.service.js';
import * as admin from './admin.service.js';
import { UTF8_BOM } from '../../lib/format.js';

export const adminRouter = Router();

const ctx = (req: Request) => ({ user: req.auth!.user, ip: req.ip ?? null });
const ok = { data: { ok: true } };

// Admins, permissions and seat limits — Super Admin only.
adminRouter.get('/admin/admins', requireSuperAdmin, async (req, res) => { res.json({ data: await accounts.adminsOverview(req.auth!.user) }); });
adminRouter.post('/admin/admins', requireSuperAdmin, async (req, res) => {
  res.status(201).json({ data: await accounts.createAdmin(body(req, createAdminSchema), ctx(req)) });
});
adminRouter.put('/admin/admins/:id/permissions', requireSuperAdmin, async (req, res) => {
  await accounts.setAdminPermissions(idParam(req), body(req, adminPermissionsSchema), ctx(req));
  res.json(ok);
});
adminRouter.patch('/admin/admins/:id/status', requireSuperAdmin, async (req, res) => {
  await accounts.setAdminStatus(idParam(req), body(req, accountStatusSchema), ctx(req));
  res.json(ok);
});

// HR / Recruiter accounts — manage_accounts (Super Admin passes).
const manageAccounts = requirePermission('manage_accounts');
adminRouter.get('/users', manageAccounts, async (req, res) => {
  res.json({ data: await accounts.hrAccounts(req.auth!.user, query(req, hrAccountsQuerySchema).status) });
});
adminRouter.post('/users', manageAccounts, async (req, res) => {
  res.status(201).json({ data: await accounts.createHr(body(req, createHrSchema), ctx(req)) });
});
adminRouter.put('/users/:id/permissions', manageAccounts, async (req, res) => {
  await accounts.setHrPermissions(idParam(req), body(req, hrPermissionsSchema).permissions, ctx(req));
  res.json(ok);
});
adminRouter.patch('/users/:id/status', manageAccounts, async (req, res) => {
  await accounts.setHrStatus(idParam(req), body(req, accountStatusSchema), ctx(req));
  res.json(ok);
});
adminRouter.post('/users/:id/reactivation', manageAccounts, async (req, res) => {
  await accounts.requestReactivation(idParam(req), body(req, reactivationSchema).reason, ctx(req));
  res.json(ok);
});
adminRouter.post('/users/:id/release-seat', requireSuperAdmin, async (req, res) => {
  await accounts.releaseSeat(idParam(req), ctx(req));
  res.json(ok);
});
adminRouter.delete('/users/:id', manageAccounts, async (req, res) => {
  await accounts.deleteHr(idParam(req), ctx(req));
  res.json(ok);
});
adminRouter.post('/account-requests/:id/decision', requireSuperAdmin, async (req, res) => {
  await accounts.decideReactivation(idParam(req), body(req, decisionSchema), ctx(req));
  res.json(ok);
});

// Password resets — Super Admin.
adminRouter.get('/password-resets', requireSuperAdmin, async (_req, res) => { res.json({ data: await admin.passwordResets() }); });
adminRouter.post('/password-resets/:id/decision', requireSuperAdmin, async (req, res) => {
  res.json({ data: await admin.decideReset(idParam(req), body(req, decisionSchema), ctx(req)) });
});

// Applicant portal — applicant_portal.
const portal = requirePermission('applicant_portal');
adminRouter.get('/portal/overview', portal, async (req, res) => { res.json({ data: await admin.portalOverview(req.auth!.user) }); });
adminRouter.put('/portal/settings', portal, async (req, res) => {
  await admin.savePortalSettings(body(req, portalSettingsSchema), ctx(req));
  res.json(ok);
});
adminRouter.patch('/portal/jobs/:id', portal, async (req, res) => {
  await admin.setPortalJobVisibility(idParam(req), body(req, portalJobVisibilitySchema).status, ctx(req));
  res.json(ok);
});
adminRouter.patch('/portal/applications/:id', portal, async (req, res) => {
  await admin.setApplicationStatus(idParam(req), body(req, portalApplicationStatusSchema).status, ctx(req));
  res.json(ok);
});

// Audit trail — audit_trail.
adminRouter.get('/audit-logs', requirePermission('audit_trail'), async (req, res) => {
  res.json({ data: await admin.auditLog(query(req, auditQuerySchema), req.auth!.user) });
});
adminRouter.get('/audit-logs.csv', requirePermission('audit_trail'), async (req, res) => {
  const csv = await admin.auditCsv(query(req, auditQuerySchema), req.auth!.user);
  await audit({ userId: req.auth!.user.id, action: 'audit_export', entityType: 'audit_logs', ip: req.ip ?? null });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename=audit-trail-${new Date().toISOString().slice(0, 10)}.csv`);
  res.send(`${UTF8_BOM}${csv}`);
});

// Settings — Admin or Super Admin.
adminRouter.get('/settings', requireAdminLevel, async (_req, res) => { res.json({ data: await admin.settings() }); });
adminRouter.put('/settings', requireAdminLevel, async (req, res) => {
  await admin.saveSettings(body(req, settingsSchema), ctx(req));
  res.json(ok);
});
