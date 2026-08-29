import { PrismaClient } from '@prisma/client';

/**
 * Prisma connects with a privileged role that BYPASSES row level security.
 * That is deliberate and it is why `project-access.service.ts` exists: the
 * service layer is the real access gate. RLS is the second line, protecting
 * anything that reaches the database through the anon key instead of here.
 *
 * Never export a raw client to a React Server Component. Go through a service.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
