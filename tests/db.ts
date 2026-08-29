import { PrismaClient } from '@prisma/client';

/**
 * A Prisma client for integration tests, deliberately on a tiny pool.
 *
 * `DATABASE_URL` points at the Supabase SESSION pooler, which hands out real
 * connections rather than multiplexing them, and this project's session mode
 * caps at **15 clients in total**. The application's own pool takes 6 of those
 * the moment any service is imported, so a test file that also opened a pool of
 * 6 would leave almost no headroom — and the failure is not a clear message but
 * `PrismaClientInitializationError` in whichever test happened to run when the
 * allowance ran out, which reads like a bug in that test.
 *
 * Two connections is plenty: the test bodies are sequential.
 *
 * Run `npm test` with the dev server stopped. It holds a pool of its own, and
 * against a 15-client ceiling that is the difference between passing and a
 * confusing failure.
 */
export function testPrisma(): PrismaClient {
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.searchParams.set('connection_limit', '2');
  url.searchParams.set('pool_timeout', '20');

  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}
