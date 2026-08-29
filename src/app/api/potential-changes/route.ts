import { jsonResponse, parseJsonBody, parseQuery, withAuth } from '@/lib/api';
import {
  createPotentialChange,
  listPotentialChanges,
  potentialChangeCreateSchema,
  potentialChangeFilterSchema,
} from '@/services/potential-change.service';
import { indexPotentialChange } from '@/services/search.service';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (request, { user }) => {
  const filters = parseQuery(request, potentialChangeFilterSchema);
  return jsonResponse(await listPotentialChanges(user, filters));
});

export const POST = withAuth(async (request, { user }) => {
  const input = await parseJsonBody(request, potentialChangeCreateSchema);
  const change = await createPotentialChange(user, input);

  // Best effort. Duplicate detection is a convenience; a failure here must
  // never cost the capture, which is already committed.
  await indexPotentialChange(change.id).catch((error) => {
    console.error('[potential-changes] indexing failed', error);
  });

  return jsonResponse(change, 201);
});
