import { jsonResponse, withAuth } from '@/lib/api';
import { findSimilarChanges } from '@/services/search.service';

export const dynamic = 'force-dynamic';

/**
 * Possible duplicates. Scoped to the change's own project — see
 * search.service.ts for why that predicate is not optional.
 */
export const GET = withAuth<{ id: string }>(async (_request, { user, params }) =>
  jsonResponse(await findSimilarChanges(user, params.id)),
);
