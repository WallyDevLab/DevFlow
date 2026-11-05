import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { TEST_DATABASE_URL } from './test-env.js';

/**
 * Prepares an isolated database for the integration tests: creates it if
 * needed, applies every migration, and empties all tables so each run starts
 * clean. It refuses to touch any database whose name doesn't contain "test",
 * because it truncates.
 */
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/i.test(dbName) || !dbName.toLowerCase().includes('test')) {
    throw new Error(
      `Refusing to run tests against "${dbName}": the database name must contain "test".`,
    );
  }

  const admin = new URL(TEST_DATABASE_URL);
  admin.pathname = '/postgres';
  const adminClient = new PrismaClient({ datasourceUrl: admin.toString() });
  try {
    await adminClient.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } catch (err) {
    if (!/already exists/i.test((err as Error).message)) throw err;
  } finally {
    await adminClient.$disconnect();
  }

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });

  const db = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
  try {
    const tables = await db.$queryRaw<{ tablename: string }[]>`
      select tablename from pg_tables
      where schemaname = 'public' and tablename <> '_prisma_migrations'`;
    if (tables.length) {
      await db.$executeRawUnsafe(
        `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`,
      );
    }
  } finally {
    await db.$disconnect();
  }
}
