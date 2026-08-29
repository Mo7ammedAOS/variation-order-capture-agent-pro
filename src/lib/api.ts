import { NextResponse } from 'next/server';
import { ZodError, type ZodSchema } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError, ValidationError, isAppError } from '@/lib/errors';
import { requireUser } from '@/lib/auth/session';
import type { AuthenticatedUser } from '@/lib/auth/provider';

/**
 * One wrapper for every route handler, so authentication, validation and the
 * error contract are uniform rather than re-decided per file.
 *
 * The 4xx/5xx split is operational, not cosmetic: n8n retries 5xx and gives up
 * on 4xx. Returning 500 for a malformed payload would have a courier retry a
 * body that can never succeed, forever.
 */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function errorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  if (isAppError(error)) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: { code: 'CONFLICT', message: 'That record already exists' } },
        { status: 409 },
      );
    }
    if (error.code === 'P2025') {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Not found' } },
        { status: 404 },
      );
    }
  }

  // Anything unrecognised is ours. Log it server-side; tell the caller nothing
  // beyond "we failed", because stack traces and driver messages leak schema.
  console.error('[api] unhandled error', error);
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
    { status: 500 },
  );
}

type RouteContext<TParams> = { params: Promise<TParams> };

/** Authenticated handler. Rejects with 401 before the handler body runs. */
export function withAuth<TParams = Record<string, string>>(
  handler: (
    request: Request,
    context: { user: AuthenticatedUser; params: TParams },
  ) => Promise<Response> | Response,
) {
  return async (request: Request, routeContext: RouteContext<TParams>) => {
    try {
      const user = await requireUser();
      const params = await routeContext.params;
      return await handler(request, { user, params });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** Unauthenticated handler, for the integration routes which verify an HMAC. */
export function withRoute<TParams = Record<string, string>>(
  handler: (
    request: Request,
    context: { params: TParams },
  ) => Promise<Response> | Response,
) {
  return async (request: Request, routeContext: RouteContext<TParams>) => {
    try {
      const params = await routeContext.params;
      return await handler(request, { params });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export async function parseJsonBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
  return schema.parse(payload);
}

export function parseQuery<T>(request: Request, schema: ZodSchema<T>): T {
  const url = new URL(request.url);
  const raw: Record<string, string | string[]> = {};

  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    raw[key] = values.length > 1 ? values : (values[0] ?? '');
  }

  return schema.parse(raw);
}

export function jsonResponse<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data as object, { status });
}

export { AppError };
