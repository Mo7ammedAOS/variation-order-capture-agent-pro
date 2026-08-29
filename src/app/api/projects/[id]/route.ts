import { jsonResponse, parseJsonBody, withAuth } from '@/lib/api';
import { getProject, projectUpdateSchema, updateProject } from '@/services/project.service';

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ id: string }>(async (_request, { user, params }) =>
  jsonResponse(await getProject(user, params.id)),
);

export const PATCH = withAuth<{ id: string }>(async (request, { user, params }) => {
  const input = await parseJsonBody(request, projectUpdateSchema);
  return jsonResponse(await updateProject(user, params.id, input));
});
