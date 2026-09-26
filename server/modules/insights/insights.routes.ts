import { Router } from 'express';
import { analyticsQuerySchema } from '../../../shared/api/insights.js';
import { audit } from '../../core/audit.js';
import { query } from '../../http/validate.js';
import { requireStaff } from '../../middleware/guards.js';
import * as service from './insights.service.js';
import { UTF8_BOM } from '../../lib/format.js';

export const insightsRouter = Router();

insightsRouter.get('/dashboard', requireStaff, async (_req, res) => { res.json({ data: await service.dashboard() }); });

insightsRouter.get('/analytics', requireStaff, async (req, res) => {
  res.json({ data: await service.analytics(query(req, analyticsQuerySchema), req.auth!.user) });
});

insightsRouter.get('/analytics/report', requireStaff, async (req, res) => {
  res.json({ data: await service.report(query(req, analyticsQuerySchema), req.auth!.user) });
});

insightsRouter.get('/analytics/report.csv', requireStaff, async (req, res) => {
  const q = query(req, analyticsQuerySchema);
  const data = await service.report(q, req.auth!.user);
  await audit({ userId: req.auth!.user.id, action: 'analytics_report_export', entityType: 'user', entityId: q.user ?? null, details: { period: data.range.label, people: data.rows.length }, ip: req.ip ?? null });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename=hr-recruiter-report-${new Date().toISOString().slice(0, 10)}.csv`);
  res.send(`${UTF8_BOM}${service.reportCsv(data, req.auth!.user.name)}`);
});
