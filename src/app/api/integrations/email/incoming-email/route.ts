import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { verifyIntegrationRequest } from '@/lib/integration-auth';
import { checkRateLimit, INTEGRATION_RATE_LIMIT } from '@/lib/rate-limit';
import { emailIncomingSchema } from '@/app/api/integrations/schemas';
import { processOnce } from '@/services/integration.service';
import { captureFromChannel } from '@/services/capture.service';

export const dynamic = 'force-dynamic';

/** Lane B. n8n watches the VO mailbox and posts each message here. */
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    verifyIntegrationRequest(raw, request.headers);

    checkRateLimit('integration:email', INTEGRATION_RATE_LIMIT);

    const payload = emailIncomingSchema.parse(JSON.parse(raw));

    const text = [payload.subject, payload.body_text].filter(Boolean).join('\n\n').trim();

    const outcome = await processOnce(
      'email',
      payload.idempotency_key,
      payload,
      async (eventId) =>
        captureFromChannel({
          channel: 'email',
          senderIdentifier: payload.from.address,
          senderName: payload.from.name ?? null,
          text: text || '[empty email]',
          externalMessageId: payload.idempotency_key,
          eventDate: payload.received_at,
          projectCodeHint: payload.project_code ?? null,
        }, eventId),
      // A parked message is not a processed one. Without this the triage inbox
      // is empty while messages quietly pile up inside result_json.
      (outcome) => (outcome.kind === 'needs_triage' ? 'needs_triage' : 'processed'),
    );

    return NextResponse.json(
      { duplicate: outcome.duplicate, event_id: outcome.eventId, result: outcome.result },
      { status: outcome.duplicate ? 200 : 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
