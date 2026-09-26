import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/setup/global-db.ts'],
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      APP_URL: 'http://localhost:5173',
      SESSION_SECRET: 'test-secret-test-secret-test-secret-0123456789',
      DATABASE_POOL_MAX: '1',
      STORAGE_DRIVER: 'local',
      LOCAL_STORAGE_DIR: '.data/test-storage',
      REALTIME_DRIVER: 'local',
      EMAIL_PROVIDER: 'log',
      N8N_ENABLED: 'false',
      CRON_SECRET: 'test-cron',
    },
  },
});
