import 'dotenv/config';
import { createServer } from 'node:http';
import { env } from './config/env.js';
import { createApp } from './app.js';
import { attachLocalHub } from './realtime/local-hub.js';
import { registerLocalHub } from './realtime/publisher.js';

const server = createServer(createApp());
if (env.REALTIME_DRIVER === 'local') registerLocalHub(attachLocalHub(server));

server.listen(env.PORT, () => {
  console.log(`[api] listening on http://localhost:${env.PORT} (storage=${env.STORAGE_DRIVER}, realtime=${env.REALTIME_DRIVER}, email=${env.EMAIL_PROVIDER}, n8n=${env.N8N_ENABLED ? 'on' : 'off'})`);
});
