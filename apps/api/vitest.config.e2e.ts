import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/test-env.js';

// Runs the unit tests AND the integration tests (real app, real Postgres).
// `npm run test:cov` uses this config so coverage covers both.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_SECRET: 'test-only-secret-not-used-anywhere-else',
      DISABLE_THROTTLE: 'true',
      GITHUB_WEBHOOK_SECRET: 'whsec_test_secret',
      WEB_ORIGIN: 'http://localhost:3000',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      // The business logic the PRD says must be well covered: services, the
      // analytics maths, access rules and the auth guard.
      include: [
        'src/**/*.service.ts',
        'src/analytics/analytics.calc.ts',
        'src/auth/jwt-auth.guard.ts',
      ],
      exclude: ['src/**/*.spec.ts', 'src/prisma/**', 'src/email/**'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
