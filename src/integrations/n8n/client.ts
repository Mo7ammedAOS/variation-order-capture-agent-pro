import { getEnv } from '@/lib/env';
import { IntegrationError } from '@/lib/errors';
import { signOutboundRequest } from '@/lib/integration-auth';

/**
 * Outbound requests to n8n.
 *
 *   The app decides.        n8n delivers.
 *   The app records truth.  n8n reports a delivery result.
 *
 * NEVER mark a notice sent, an email delivered, a client notified or an
 * approval complete because a call from here returned 200. All that means is
 * that a courier accepted the parcel. The state changes only when n8n calls
 * /api/integrations/notifications/delivery-status back.
 *
 * In Phase 1 every URL is blank, so `dispatch` short-circuits and nothing
 * fires. The app runs, tests pass, and no n8n credential is needed.
 */

export type OutboundLane = 'notify-email' | 'notify-whatsapp' | 'document-move' | 'report-delivery';

function urlFor(lane: OutboundLane): string {
  const env = getEnv();
  switch (lane) {
    case 'notify-email':
      return env.N8N_NOTIFY_EMAIL_URL;
    case 'notify-whatsapp':
      return env.N8N_NOTIFY_WHATSAPP_URL;
    case 'document-move':
      return env.N8N_DOCUMENT_MOVE_URL;
    case 'report-delivery':
      return env.N8N_REPORT_DELIVERY_URL;
  }
}

export interface DispatchResult {
  /** False when no URL is configured — the Phase 1 default. */
  dispatched: boolean;
  status?: number;
}

export async function dispatch(
  lane: OutboundLane,
  payload: Record<string, unknown>,
  options: { idempotencyKey: string; timeoutMs?: number } = { idempotencyKey: '' },
): Promise<DispatchResult> {
  const url = urlFor(lane);
  if (!url) return { dispatched: false };

  const body = JSON.stringify({ ...payload, idempotency_key: options.idempotencyKey });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: signOutboundRequest(body),
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new IntegrationError(`n8n lane ${lane} returned ${response.status}`);
    }
    return { dispatched: true, status: response.status };
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError(
      `n8n lane ${lane} unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}
