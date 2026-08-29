import { jsonResponse, parseJsonBody, parseQuery, withAuth } from '@/lib/api';
import { z } from 'zod';
import { createProject, listProjects, projectCreateSchema } from '@/services/project.service';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (request, { user }) => {
  const { q } = parseQuery(request, z.object({ q: z.string().optional() }));
  return jsonResponse(await listProjects(user, { search: q }));
});

export const POST = withAuth(async (request, { user }) => {
  const input = await parseJsonBody(request, projectCreateSchema);
  return jsonResponse(await createProject(user, input), 201);
});
