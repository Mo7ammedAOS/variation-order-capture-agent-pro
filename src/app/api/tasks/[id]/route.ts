import { jsonResponse, parseJsonBody, withAuth } from '@/lib/api';
import { taskUpdateSchema, updateTask } from '@/services/task.service';

export const dynamic = 'force-dynamic';

export const PATCH = withAuth<{ id: string }>(async (request, { user, params }) => {
  const input = await parseJsonBody(request, taskUpdateSchema);
  return jsonResponse(await updateTask(user, params.id, input));
});
