import { jsonResponse, parseQuery, withAuth } from '@/lib/api';
import { z } from 'zod';
import { listBottlenecks } from '@/services/bottleneck.service';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (request, { user }) => {
  const filters = parseQuery(
    request,
    z.object({
      projectId: z.string().uuid().optional(),
      includeResolved: z.coerce.boolean().optional(),
    }),
  );
  return jsonResponse(await listBottlenecks(user, filters));
});
