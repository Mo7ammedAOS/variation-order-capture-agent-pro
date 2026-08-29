import { jsonResponse, parseJsonBody, withAuth } from '@/lib/api';
import { assessNotice, noticeAssessmentSchema } from '@/services/notice.service';

export const dynamic = 'force-dynamic';

/** The entitlement decision. Requires potentialChange.assessNotice on the project. */
export const POST = withAuth<{ id: string }>(async (request, { user, params }) => {
  const input = await parseJsonBody(request, noticeAssessmentSchema);
  return jsonResponse(await assessNotice(user, params.id, input));
});
