// Local default matches docker-compose.yml (Postgres on 5433). CI sets
// TEST_DATABASE_URL to its service container.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://devflow:devflow@localhost:5433/devflow_test';
