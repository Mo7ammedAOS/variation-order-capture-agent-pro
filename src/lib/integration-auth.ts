import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv } from '@/lib/env';
import { UnauthenticatedError, ValidationError } from '@/lib/errors';

/**
 * Authentication for the inbound integration routes — the doors n8n knocks on.
 *
 * A shared bearer secret would be enough to prove "someone knows the secret",
 * but not "this body was not altered". An HMAC over the raw body proves both,
 * and costs nothing. The comparison is constant-time: a fast `===` on a secret
 * leaks its prefix through timing, slowly but genuinely.
 *
 * Replay is handled separately, by the idempotency key — see IntegrationEvent.
 */

export const SIGNATURE_HEADER = 'x-vo-signature';
export const TIMESTAMP_HEADER = 'x-vo-timestamp';

/** How far out of step a caller's clock may be before we reject the request. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function computeSignature(rawBody: string, timestamp: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/**
 * Verifies an inbound request. Throws rather than returning false, so a route
 * cannot forget to check the result.
 */
export function verifyIntegrationRequest(
  rawBody: string,
  headers: Headers,
  now: Date = new Date(),
): void {
  const env = getEnv();

  const signature = headers.get(SIGNATURE_HEADER);
  const timestamp = headers.get(TIMESTAMP_HEADER);

  if (!signature || !timestamp) {
    throw new UnauthenticatedError(
      `Missing ${SIGNATURE_HEADER} or ${TIMESTAMP_HEADER} header`,
    );
  }

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) {
    throw new ValidationError(`${TIMESTAMP_HEADER} must be epoch milliseconds`);
  }

  // A signature is valid forever unless it is bound to a time. Without this,
  // a captured request could be replayed months later.
  if (Math.abs(now.getTime() - timestampMs) > MAX_CLOCK_SKEW_MS) {
    throw new UnauthenticatedError('Request timestamp is outside the accepted window');
  }

  const expected = computeSignature(rawBody, timestamp, env.N8N_WEBHOOK_SECRET);

  if (!constantTimeEquals(signature, expected)) {
    throw new UnauthenticatedError('Invalid request signature');
  }
}

/** Builds the headers for an OUTBOUND call to n8n. */
export function signOutboundRequest(
  rawBody: string,
  now: Date = new Date(),
): Record<string, string> {
  const env = getEnv();
  const secret = env.N8N_OUTBOUND_SECRET || env.N8N_WEBHOOK_SECRET;
  const timestamp = String(now.getTime());

  return {
    'content-type': 'application/json',
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: computeSignature(rawBody, timestamp, secret),
  };
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, which is itself a leak of one
  // bit. That bit is the length of a hex digest, which is public, so returning
  // early here is fine.
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
