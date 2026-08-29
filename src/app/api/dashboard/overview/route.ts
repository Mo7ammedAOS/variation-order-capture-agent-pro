import { jsonResponse, withAuth } from '@/lib/api';
import { getOverview } from '@/services/dashboard.service';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_request, { user }) => jsonResponse(await getOverview(user)));
