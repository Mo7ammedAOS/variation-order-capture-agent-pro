import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
    /*
      One file at a time.

      The integration files all talk to the same external Postgres, and each
      opens its own Prisma pool. Run in parallel against the SESSION pooler —
      which hands out real connections rather than multiplexing them the way
      the transaction pooler does — several files at ten connections apiece
      exhausts the allowance, and the suite fails with
      PrismaClientInitializationError in tests that have nothing wrong with
      them. They also create and delete rows in a shared database, so
      serialising them removes a second class of flake at the same time.

      The cost is small: the suite is dominated by network latency to the
      database region, not by CPU, so there was little to parallelise.
    */
    fileParallelism: false,
  },
});
