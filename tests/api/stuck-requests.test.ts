import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as publicService from '../../server/modules/public/public.service.js';

/**
 * A request can wait forever on a dead database connection. The app answers a read
 * that is taking too long by retrying it once on fresh connections, and never
 * leaves the page hanging for long.
 */
async function appWithShortTimers() {
  const { createApp } = await import('../../server/app.js');
  return createApp({ readRetryAfterMs: 150, readRetryLimitMs: 400 });
}

const never = () => new Promise<never>(() => undefined);

describe('stuck database requests', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retries a read that hangs once and answers it', async () => {
    const real = publicService.publicConfig;
    let calls = 0;
    vi.spyOn(publicService, 'publicConfig').mockImplementation((...args: Parameters<typeof real>) => {
      calls++;
      return calls === 1 ? never() : real(...args);
    });

    const res = await request(await appWithShortTimers()).get('/api/v1/public/config');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeTruthy();
    expect(calls).toBe(2);
  });

  it('answers with a clear 503 when the retry hangs too', async () => {
    const spy = vi.spyOn(publicService, 'publicConfig').mockImplementation(never);

    const res = await request(await appWithShortTimers()).get('/api/v1/public/config');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('service_unavailable');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not retry anything but reads', async () => {
    const spy = vi.spyOn(publicService, 'withdraw').mockImplementation(never);
    const { createApp } = await import('../../server/app.js');
    // A write is never retried: it waits out the long limit, so it is still waiting after the read window.
    const app = createApp({ readRetryAfterMs: 100, readRetryLimitMs: 100 });

    const pending = request(app).post('/api/v1/public/status/withdraw').send({ email: 'someone@example.com', applicationId: 1 }).timeout({ deadline: 700 }).then(() => 'answered', () => 'waiting');

    expect(await pending).toBe('waiting');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
