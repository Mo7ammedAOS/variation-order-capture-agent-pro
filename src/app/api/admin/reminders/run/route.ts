import { jsonResponse, withAuth } from '@/lib/api';
import { assertCapability } from '@/services/project-access.service';
import { runReminderSweep } from '@/services/reminder.service';

/**
 * Runs the chase on demand.
 *
 * It exists so the behaviour can be PROVEN rather than waited for. A daily
 * sweep that can only be observed by leaving a task overdue and coming back
 * tomorrow is a feature nobody ever verifies, and the first time anyone finds
 * out it is broken is when a notice deadline passes unchased.
 *
 * Safe to call repeatedly: every message carries a dedupe key unique to its
 * task, kind, day, channel and recipient, so a second run on the same day
 * inserts nothing and nobody is messaged twice.
 */
export const dynamic = 'force-dynamic';

export const POST = withAuth(async (_request, { user }) => {
  await assertCapability(user, 'companySettings.manage');
  return jsonResponse(await runReminderSweep());
});
