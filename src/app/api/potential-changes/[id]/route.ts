import { jsonResponse, parseJsonBody, withAuth } from '@/lib/api';
import {
  getPotentialChange,
  potentialChangeUpdateSchema,
  updatePotentialChange,
} from '@/services/potential-change.service';
import { indexPotentialChange } from '@/services/search.service';

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ id: string }>(async (_request, { user, params }) =>
  jsonResponse(await getPotentialChange(user, params.id)),
);

export const PATCH = withAuth<{ id: string }>(async (request, { user, params }) => {
  const input = await parseJsonBody(request, potentialChangeUpdateSchema);
  const updated = await updatePotentialChange(user, params.id, input);

  if (input.title || input.description) {
    await indexPotentialChange(params.id).catch(() => undefined);
  }
  return jsonResponse(updated);
});
