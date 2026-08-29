import { jsonResponse, parseJsonBody, withAuth } from '@/lib/api';
import {
  contractRuleUpdateSchema,
  getContractRules,
  updateContractRules,
} from '@/services/project.service';

export const dynamic = 'force-dynamic';

/**
 * Reading the rules needs project access; changing them needs the
 * `project.manageContractRules` capability on top. Both checks live in the
 * service, so this route and the settings form cannot drift apart on who is
 * allowed to do what.
 */
export const GET = withAuth<{ id: string }>(async (_request, { user, params }) =>
  jsonResponse(await getContractRules(user, params.id)),
);

export const PATCH = withAuth<{ id: string }>(async (request, { user, params }) => {
  const input = await parseJsonBody(request, contractRuleUpdateSchema);
  return jsonResponse(await updateContractRules(user, params.id, input));
});
