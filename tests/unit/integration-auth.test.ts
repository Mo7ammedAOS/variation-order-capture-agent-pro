import { beforeAll, describe, expect, it } from 'vitest';

const SECRET = 'test-secret-value-1234567890';

beforeAll(() => {
  Object.assign(process.env, {
    N8N_WEBHOOK_SECRET: SECRET,
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
  });
});

describe('inbound request signing', () => {
  it('accepts a correctly signed request', async () => {
    const { computeSignature, verifyIntegrationRequest, SIGNATURE_HEADER, TIMESTAMP_HEADER } =
      await import('@/lib/integration-auth');

    const body = JSON.stringify({ idempotency_key: 'abc' });
    const timestamp = String(Date.now());
    const headers = new Headers({
      [TIMESTAMP_HEADER]: timestamp,
      [SIGNATURE_HEADER]: computeSignature(body, timestamp, SECRET),
    });

    expect(() => verifyIntegrationRequest(body, headers)).not.toThrow();
  });

  it('rejects a body that was altered after signing', async () => {
    const { computeSignature, verifyIntegrationRequest, SIGNATURE_HEADER, TIMESTAMP_HEADER } =
      await import('@/lib/integration-auth');

    const timestamp = String(Date.now());
    const headers = new Headers({
      [TIMESTAMP_HEADER]: timestamp,
      [SIGNATURE_HEADER]: computeSignature('{"amount":100}', timestamp, SECRET),
    });

    expect(() => verifyIntegrationRequest('{"amount":999999}', headers)).toThrow();
  });

  it('rejects a request with no signature at all', async () => {
    const { verifyIntegrationRequest } = await import('@/lib/integration-auth');
    expect(() => verifyIntegrationRequest('{}', new Headers())).toThrow();
  });

  it('rejects a replayed request from outside the time window', async () => {
    const { computeSignature, verifyIntegrationRequest, SIGNATURE_HEADER, TIMESTAMP_HEADER } =
      await import('@/lib/integration-auth');

    const body = '{}';
    const oldTimestamp = String(Date.now() - 60 * 60 * 1000);
    const headers = new Headers({
      [TIMESTAMP_HEADER]: oldTimestamp,
      [SIGNATURE_HEADER]: computeSignature(body, oldTimestamp, SECRET),
    });

    // The signature is valid forever unless it is bound to a time.
    expect(() => verifyIntegrationRequest(body, headers)).toThrow();
  });

  it('rejects a signature made with the wrong secret', async () => {
    const { computeSignature, verifyIntegrationRequest, SIGNATURE_HEADER, TIMESTAMP_HEADER } =
      await import('@/lib/integration-auth');

    const body = '{}';
    const timestamp = String(Date.now());
    const headers = new Headers({
      [TIMESTAMP_HEADER]: timestamp,
      [SIGNATURE_HEADER]: computeSignature(body, timestamp, 'a-different-secret'),
    });

    expect(() => verifyIntegrationRequest(body, headers)).toThrow();
  });
});
