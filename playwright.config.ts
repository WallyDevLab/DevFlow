import { defineConfig, devices } from '@playwright/test';

// In CI the config starts its own API and web servers against a throwaway
// database. Locally you can point it at servers you already run:
//   E2E_SKIP_SERVERS=1 E2E_WEB_URL=http://localhost:3000 PW_CHANNEL=chrome npx playwright test
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3100';
const API_PORT = 4100;
const TEST_DB =
  process.env.TEST_DATABASE_URL ??
  'postgresql://devflow:devflow@localhost:5433/devflow_test';

export default defineConfig({
  testDir: './e2e',
  // Tests share servers and a database; they use unique accounts, but running
  // them one at a time keeps failures easy to read.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // "chrome" reuses an installed Chrome instead of downloading a browser.
    channel: process.env.PW_CHANNEL || undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_SKIP_SERVERS
    ? undefined
    : [
        {
          // Expects `npm run build -w apps/api` and a migrated database first (see CI).
          command: 'node apps/api/dist/main.js',
          url: `http://localhost:${API_PORT}/api/v1/auth/me`,
          // /auth/me answers 401 when the server is up, which is all we need.
          ignoreHTTPSErrors: true,
          reuseExistingServer: !process.env.CI,
          env: {
            NODE_ENV: 'test', // cheap password hashing, throttling switch
            DISABLE_THROTTLE: 'true',
            PORT: String(API_PORT),
            DATABASE_URL: TEST_DB,
            JWT_SECRET: 'e2e-only-secret',
            WEB_ORIGIN: WEB_URL,
          },
          timeout: 60_000,
        },
        {
          // Expects `npm run build -w apps/web` with NEXT_PUBLIC_API_URL set (see CI).
          command: 'npm run start -w apps/web -- -p 3100',
          url: WEB_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 90_000,
        },
      ],
});
