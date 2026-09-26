import 'dotenv/config';
import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { env } from './config/env.js';
import { createApp } from './app.js';

/**
 * Self-hosted production entry (npm run build && npm run start): the API plus
 * the built SPA from one Node process. On Vercel, api/index.ts is used instead.
 */
const app = createApp();
const dist = path.resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.listen(env.PORT, () => console.log(`[acme] serving on :${env.PORT}`));
