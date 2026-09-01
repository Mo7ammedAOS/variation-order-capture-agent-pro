import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { verifyIntegrationRequest } from '@/lib/integration-auth';
import { checkRateLimit, INTEGRATION_RATE_LIMIT } from '@/lib/rate-limit';
import { assertCaptureBodySize, whatsappIncomingSchema } from '@/app/api/integrations/schemas';
import { processOnce } from '@/services/integration.service';
import { attachmentsFromPayload, captureFromChannel } from '@/services/capture.service';

export const dynamic = 'force-dynamic';

/**
 * Lane A. n8n receives a WhatsApp message, downloads any media, and posts here.
 *
 * Order is deliberate and must not be rearranged:
 *   verify signature -> rate limit -> validate -> idempotency -> business rules
 *
 * Validating before verifying would let an unauthenticated caller probe the
 * schema; doing idempotency after the business rules would let a retry create
 * a second Potential Change.
 */
export async function POST(request: Request) {
  try {
    // The signature covers the RAW body, so it must be read as text first.
    // Parsing to JSON and re-serialising would change the bytes and fail.
    const raw = await request.text();
    verifyIntegrationRequest(raw, request.headers);
    assertCaptureBodySize(raw);

    checkRateLimit('integration:whatsapp', INTEGRATION_RATE_LIMIT);

    const payload = whatsappIncomingSchema.parse(JSON.parse(raw));

    const text = [payload.message.text, payload.message.caption].filter(Boolean).join('\n').trim();

    const outcome = await processOnce(
      'whatsapp',
      payload.idempotency_key,
      payload,
      async (eventId) =>
        captureFromChannel({
          channel: 'whatsapp',
          senderIdentifier: payload.sender.phone,
          senderName: payload.sender.display_name ?? null,
          text: text || '[media only]',
          externalMessageId: payload.idempotency_key,
          eventDate: payload.received_at,
          projectCodeHint: payload.project_code ?? null,
          // Site photos and voice notes, filed as evidence on the change.
          attachments: attachmentsFromPayload(payload),
        }, eventId),
      // A parked message is not a processed one. Without this the triage inbox
      // is empty while messages quietly pile up inside result_json.
      (outcome) =>
        outcome.kind === 'needs_triage'
          ? 'needs_triage'
          : outcome.kind === 'cancelled'
            ? 'ignored'
            : 'processed',
    );

    return NextResponse.json(
      { duplicate: outcome.duplicate, event_id: outcome.eventId, result: outcome.result },
      { status: outcome.duplicate ? 200 : 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
