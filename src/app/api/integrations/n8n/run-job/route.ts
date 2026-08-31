import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { verifyIntegrationRequest } from '@/lib/integration-auth';
import { checkRateLimit, INTEGRATION_RATE_LIMIT } from '@/lib/rate-limit';
import { scheduledJobSchema } from '@/app/api/integrations/schemas';
import { runReminderSweep } from '@/services/reminder.service';
import { runDetectionSweep } from '@/services/bottleneck.service';
import { dispatchPendingNotifications } from '@/services/notification.service';

export const dynamic = 'force-dynamic';

/**
 * The clock, moved out of the app.
 *
 * ── Why n8n holds the schedule and the app holds the judgement ─────────────
 * Until now the chase ran on a `setInterval` inside the web container: real,
 * but invisible. You could not see whether it had run, pause it for a day, or
 * tell a missed deploy from a broken sweep. n8n gives all three back, and it
 * shows every scheduled thing this system does on one screen.
 *
 * What did NOT move is which people are owed what. That stays in
 * reminder.service, where the escalation ladder and the dedupe key are tested.
 * Expressed as n8n nodes it would be a diagram nobody can run twice safely —
 * and an execution retried after a timeout would chase the same project
 * manager a second time. A system that double-chases gets muted, and a muted
 * system is worth nothing on the day a notice is actually due.
 *
 * ── Why there is no idempotency key here ───────────────────────────────────
 * Every route beside this one is idempotent by refusing to repeat itself.
 * These three are idempotent by BEING repeatable: each reads current state and
 * works out what is owed now. Running the sweep twice in a minute writes
 * nothing the second time, because the notification dedupe key already covers
 * task, kind, day, channel and recipient. So a retry is safe, and — more
 * importantly — a MISSED run is recoverable, which a queue of scheduled
 * per-task jobs would not be.
 *
 * ── Why the response carries counts ────────────────────────────────────────
 * So the n8n execution list is evidence. "200 OK" tells you the door opened;
 * `{ remindersWritten: 0 }` every day for a week tells you something is wrong
 * that a green tick would have hidden.
 */
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    verifyIntegrationRequest(raw, request.headers);

    checkRateLimit('integration:run-job', INTEGRATION_RATE_LIMIT);

    const { job } = scheduledJobSchema.parse(JSON.parse(raw));
    const startedAt = Date.now();

    const result = await runJob(job);

    return NextResponse.json(
      { job, ...result, duration_ms: Date.now() - startedAt },
      { status: 200 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

async function runJob(job: 'reminder_sweep' | 'bottleneck_sweep' | 'notification_dispatch') {
  switch (job) {
    case 'reminder_sweep':
      return runReminderSweep();

    case 'bottleneck_sweep':
      // Had no caller at all until now. The detection logic has existed since
      // the first build and has never once run outside a test, so the
      // bottleneck page only ever showed what a person entered by hand.
      return runDetectionSweep();

    case 'notification_dispatch':
      // The sweep already dispatches what it writes. This exists for the rows
      // it could not hand over at the time — a lane that was down, or not yet
      // configured — which would otherwise sit pending until the next task
      // happened to come due.
      return dispatchPendingNotifications();
  }
}
