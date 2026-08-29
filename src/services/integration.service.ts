import 'server-only';
import type { IntegrationSource, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * The integration boundary.
 *
 * Rule 2: every external event carries an idempotency key, and a retried
 * webhook must never create a second Potential Change. That guarantee lives
 * here rather than in each route, so it cannot be forgotten in one of them.
 *
 * The unique index on (source, external_id) is what actually enforces it. The
 * pre-check below is an optimisation; the insert is the guarantee, and the
 * P2002 catch is the path a genuine race takes.
 */

export interface IdempotentResult<T> {
  /** True when this exact event was already processed. */
  duplicate: boolean;
  eventId: string;
  result: T | null;
}

export async function findExistingEvent(source: IntegrationSource, externalId: string) {
  return prisma.integrationEvent.findUnique({
    where: { source_externalId: { source, externalId } },
  });
}

/**
 * Runs `process` exactly once for a given (source, externalId).
 *
 * A second delivery returns the FIRST delivery's stored result, so the courier
 * sees a coherent answer instead of a conflict it would retry forever.
 */
export async function processOnce<T>(
  source: IntegrationSource,
  externalId: string,
  payload: unknown,
  process: () => Promise<T>,
): Promise<IdempotentResult<T>> {
  const existing = await findExistingEvent(source, externalId);
  if (existing) {
    return {
      duplicate: true,
      eventId: existing.id,
      result: (existing.resultJson as T | null) ?? null,
    };
  }

  let event;
  try {
    event = await prisma.integrationEvent.create({
      data: {
        source,
        externalId,
        payloadJson: toJson(payload),
        status: 'received',
      },
    });
  } catch (error) {
    // Two deliveries landed at once and the other won the unique index. That
    // is the system working: fall back to the winner's row.
    if (isUniqueViolation(error)) {
      const winner = await findExistingEvent(source, externalId);
      if (winner) {
        return {
          duplicate: true,
          eventId: winner.id,
          result: (winner.resultJson as T | null) ?? null,
        };
      }
    }
    throw error;
  }

  try {
    const result = await process();
    await prisma.integrationEvent.update({
      where: { id: event.id },
      data: { status: 'processed', processedAt: new Date(), resultJson: toJson(result) },
    });
    return { duplicate: false, eventId: event.id, result };
  } catch (error) {
    // The event row stays, marked failed, carrying the payload. Nothing is lost
    // and the failure is inspectable rather than existing only in a log line.
    await prisma.integrationEvent.update({
      where: { id: event.id },
      data: {
        status: 'failed',
        processedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

/** Events received but not yet turned into a record — the triage queue. */
export async function listUnprocessedEvents(limit = 50) {
  return prisma.integrationEvent.findMany({
    where: { status: { in: ['received', 'failed'] } },
    orderBy: { receivedAt: 'desc' },
    take: limit,
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
