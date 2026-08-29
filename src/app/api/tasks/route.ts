import { jsonResponse, parseJsonBody, parseQuery, withAuth } from '@/lib/api';
import { z } from 'zod';
import { createTask, listTasks, taskCreateSchema } from '@/services/task.service';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (request, { user }) => {
  const filters = parseQuery(
    request,
    z.object({
      projectId: z.string().uuid().optional(),
      assignedToUserId: z.string().uuid().optional(),
      status: z.string().optional(),
    }),
  );
  return jsonResponse(await listTasks(user, filters));
});

export const POST = withAuth(async (request, { user }) => {
  const input = await parseJsonBody(request, taskCreateSchema);
  return jsonResponse(await createTask(user, input), 201);
});
