import type { Router } from 'express';
import { adminRouter } from './modules/admin/admin.routes.js';
import { candidatesRouter } from './modules/candidates/candidates.routes.js';
import { cronRouter } from './modules/cron/cron.routes.js';
import { insightsRouter } from './modules/insights/insights.routes.js';
import { interviewsRouter } from './modules/interviews/interviews.routes.js';
import { jobsRouter } from './modules/jobs/jobs.routes.js';
import { meRouter } from './modules/me/me.routes.js';
import { peopleRouter } from './modules/people/people.routes.js';
import { pipelineRouter } from './modules/pipeline/pipeline.routes.js';
import { publicRouter } from './modules/public/public.routes.js';

/** Feature routers, each mounted under /api/v1. */
export const featureRouters: Router[] = [
  publicRouter,
  meRouter,
  insightsRouter,
  candidatesRouter,
  pipelineRouter,
  interviewsRouter,
  jobsRouter,
  peopleRouter,
  adminRouter,
  cronRouter,
];
