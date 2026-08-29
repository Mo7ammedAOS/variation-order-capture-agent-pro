import { jsonResponse, parseJsonBody, withAuth } from '@/lib/api';
import { z } from 'zod';
import { assignMember, listMembers, memberAssignSchema } from '@/services/project-member.service';

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ id: string }>(async (_request, { user, params }) =>
  jsonResponse(await listMembers(user, params.id)),
);

export const POST = withAuth<{ id: string }>(async (request, { user, params }) => {
  // The project comes from the URL, never the body — otherwise a caller could
  // grant themselves membership of a project they cannot see.
  const body = await parseJsonBody(
    request,
    memberAssignSchema.omit({ projectId: true }).extend({ projectId: z.string().optional() }),
  );
  return jsonResponse(
    await assignMember(user, {
      projectId: params.id,
      userId: body.userId,
      projectRole: body.projectRole,
    }),
    201,
  );
});
