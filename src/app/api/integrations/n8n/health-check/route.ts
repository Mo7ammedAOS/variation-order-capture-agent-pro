import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { verifyIntegrationRequest } from '@/lib/integration-auth';
import { prisma } from '@/lib/prisma';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Lets an n8n workflow confirm it can reach the app AND that its shared secret
 * is right, before a real event depends on both.
 *
 * Still signed. An unauthenticated health endpoint that reports the database is
 * up is a free liveness probe for anyone scanning.
 */
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    verifyIntegrationRequest(raw, request.headers);

    const env = getEnv();
    let database: 'ok' | 'unreachable' = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'unreachable';
    }

    return NextResponse.json(
      {
        status: database === 'ok' ? 'ok' : 'degraded',
        client_slug: env.CLIENT_SLUG,
        database,
        storage_provider: env.STORAGE_PROVIDER,
        timestamp: new Date().toISOString(),
      },
      { status: database === 'ok' ? 200 : 503 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
