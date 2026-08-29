import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { verifyIntegrationRequest } from '@/lib/integration-auth';
import { checkRateLimit, INTEGRATION_RATE_LIMIT } from '@/lib/rate-limit';
import { deliveryStatusSchema } from '@/app/api/integrations/schemas';
import { processOnce } from '@/services/integration.service';
import { recordDeliveryResult } from '@/services/notice.service';

export const dynamic = 'force-dynamic';

/**
 * The report-back that closes the loop.
 *
 * This is the ONLY thing that may move a notification to `sent`. Asking n8n to
 * send something does not make it sent; this callback arriving does. Until then
 * the record stays `pending`, and on failure it becomes `failed` with a reason.
 *
 * A notice is not served because we asked for it to be served.
 */
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    verifyIntegrationRequest(raw, request.headers);

    checkRateLimit('integration:delivery-status', INTEGRATION_RATE_LIMIT);

    const payload = deliveryStatusSchema.parse(JSON.parse(raw));

    const outcome = await processOnce(
      'notification_status',
      payload.idempotency_key,
      payload,
      async () => {
        const updated = await recordDeliveryResult({
          notificationId: payload.notification_id,
          status: payload.status,
          externalMessageId: payload.external_message_id ?? null,
          failureReason: payload.failure_reason ?? null,
        });
        return { notificationId: updated.id, status: updated.status };
      },
    );

    return NextResponse.json(
      { duplicate: outcome.duplicate, event_id: outcome.eventId, result: outcome.result },
      { status: 200 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
