import { applyD1Migrations, env } from "cloudflare:test";

// Runs before each test file (each file has its own storage): applies the worker's D1 migrations
// so tests start from the real schema.

const testEnv = env as unknown as Record<string, unknown> & {
  TEST_D1_BINDING: string;
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
};

if (testEnv.TEST_D1_BINDING) {
  await applyD1Migrations(testEnv[testEnv.TEST_D1_BINDING] as D1Database, testEnv.TEST_MIGRATIONS);
}
