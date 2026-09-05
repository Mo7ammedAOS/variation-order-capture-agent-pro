import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { getEnv } from '@/lib/env';
import { ValidationError } from '@/lib/errors';
import { verifyIntegrationRequest } from '@/lib/integration-auth';
import { checkRateLimit, INTEGRATION_RATE_LIMIT } from '@/lib/rate-limit';
import { scheduledJobSchema } from '@/app/api/integrations/schemas';
import { runReminderSweep } from '@/services/reminder.service';
import { runClientFollowUp } from '@/services/client-followup.service';
import { runDetectionSweep } from '@/services/bottleneck.service';
import { dispatchPendingNotifications } from '@/services/notification.service';
import { fileUnfiledNotices } from '@/services/notice-document.service';

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
 *
 * ── `as_of`, and why testing needed it ─────────────────────────────────────
 * Everything contractual here is a function of dates. A notice is due 28 days
 * after the event; a client is chased every 7; an assessment turns red when
 * its deadline passes. So "run it now" proves almost nothing on the day you
 * built the data — the honest answer to every sweep is "nothing is due yet",
 * and finding out whether the chase works would mean waiting a month.
 *
 * `as_of` tells the sweep what day to believe it is. Nothing is faked and
 * nothing is back-dated: the same code runs against the same rows and either
 * decides something is due or does not. What comes out is a real reminder, a
 * real escalation, a real chase email — which is the point, because a test
 * that stops short of the email has not tested the part that can be wrong.
 *
 * It is refused unless ALLOW_JOB_TIME_TRAVEL is on, and capped either way. A
 * schedule node edited by accident must not be able to chase a client about a
 * deadline six months out, because the client cannot tell that from a real one.
 */

/** Far enough to cross any contractual window; short of anything absurd. */
const MAX_TRAVEL_DAYS = 400;

function resolveAsOf(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;

  if (getEnv().ALLOW_JOB_TIME_TRAVEL !== 'true') {
    throw new ValidationError(
      'as_of was supplied but ALLOW_JOB_TIME_TRAVEL is not enabled on this deployment.',
    );
  }

  // A bare date means the start of that day. Left to `new Date()` alone,
  // "2026-10-04" is midnight UTC, which is 04:00 in Dubai — inside the sweep's
  // own sending hours, and therefore the behaviour a person testing expects.
  const asOf = new Date(raw.length === 10 ? `${raw}T00:00:00.000Z` : raw);
  if (Number.isNaN(asOf.getTime())) throw new ValidationError('as_of is not a date.');

  const days = Math.abs(asOf.getTime() - Date.now()) / 86_400_000;
  if (days > MAX_TRAVEL_DAYS) {
    throw new ValidationError(`as_of is more than ${MAX_TRAVEL_DAYS} days away.`);
  }

  // Loud on purpose. Anything this run sends is indistinguishable from the
  // real thing at the far end, so the log has to say why it happened.
  console.warn(`[run-job] TIME TRAVEL: running as if it were ${asOf.toISOString()}`);
  return asOf;
}
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    verifyIntegrationRequest(raw, request.headers);

    checkRateLimit('integration:run-job', INTEGRATION_RATE_LIMIT);

    const { job, as_of: asOfRaw } = scheduledJobSchema.parse(JSON.parse(raw));
    const asOf = resolveAsOf(asOfRaw);
    const startedAt = Date.now();

    const result = await runJob(job, asOf ?? new Date());

    return NextResponse.json(
      {
        job,
        // Echoed back so an execution in the n8n list is self-explanatory. A
        // run that wrote four reminders needs to say whether it did so because
        // four were genuinely due today.
        ran_as_of: (asOf ?? new Date()).toISOString(),
        simulated: asOf !== undefined,
        ...result,
        duration_ms: Date.now() - startedAt,
      },
      { status: 200 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

async function runJob(
  job: 'reminder_sweep' | 'bottleneck_sweep' | 'notification_dispatch' | 'client_followup',
  now: Date,
) {
  switch (job) {
    case 'reminder_sweep':
      return runReminderSweep(now);

    case 'client_followup':
      // The chase for an answer on a submitted variation, and the only
      // scheduled job that writes to somebody outside the company.
      //
      // The CADENCE is decided per project, in the contract rules, not by the
      // schedule. n8n fires this every morning and most mornings it writes
      // nothing — so a schedule somebody edits by accident cannot turn a
      // weekly chase into a daily one, which is the mistake that would cost a
      // client relationship rather than a record.
      return runClientFollowUp(now);

    case 'bottleneck_sweep':
      // Had no caller at all until now. The detection logic has existed since
      // the first build and has never once run outside a test, so the
      // bottleneck page only ever showed what a person entered by hand.
      return runDetectionSweep(now);

    case 'notification_dispatch': {
      // The sweep already dispatches what it writes. This exists for the rows
      // it could not hand over at the time — a lane that was down, or not yet
      // configured — which would otherwise sit pending until the next task
      // happened to come due.
      const dispatched = await dispatchPendingNotifications();

      // Same idea, one shelf along: a notice whose PDF never reached Drive
      // because storage was down or the Google token had expired. The notice
      // was validly issued either way, so this retries the filing rather than
      // holding up the issue. Folded into this job instead of becoming a
      // fourth schedule, so lane S does not have to change.
      const filed = await fileUnfiledNotices();

      return { ...dispatched, noticesFiled: filed.filed, noticesUnfilable: filed.failed };
    }
  }
}
