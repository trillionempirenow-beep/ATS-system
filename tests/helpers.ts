import request from 'supertest';
import type { Express } from 'express';

let app: Express | null = null;

export async function getApp(): Promise<Express> {
  if (!app) {
    const { createApp } = await import('../server/app.js');
    app = createApp();
  }
  return app;
}

export interface Session {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  me: { id: number; role: string; permissions: string[] };
}

export async function signIn(email: string, password = 'password'): Promise<Session> {
  const agent = request.agent(await getApp());
  const res = await agent.post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`sign in failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, csrf: res.body.data.csrfToken as string, me: res.body.data };
}

export const USERS = {
  superAdmin: 'superadmin@acme.test',
  admin: 'admin@acme.test',
  recruiter: 'recruiter@acme.test',
  manager: 'manager@acme.test',
  employee: 'employee@acme.test',
};

export async function anon() {
  return request(await getApp());
}
