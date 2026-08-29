import { jsonResponse, parseJsonBody, withAuth } from '@/lib/api';
import { changeStatus, statusChangeSchema } from '@/services/potential-change.service';

export const dynamic = 'force-dynamic';

/**
 * Moving a change along its lifecycle.
 *
 * The legal transitions live in the service, not here, so this route and the
 * detail page's control cannot disagree about what is permitted. An illegal
 * move returns 400 with the reason, not 500 — the caller sent something this
 * change cannot do, which is their fault and not worth retrying.
 */
export const PATCH = withAuth<{ id: string }>(async (request, { user, params }) => {
  const { status, note } = await parseJsonBody(request, statusChangeSchema);
  return jsonResponse(await changeStatus(user, params.id, status, note));
});
