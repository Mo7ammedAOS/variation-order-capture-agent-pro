import 'server-only';
import { DEFAULT_TIMEZONE } from '@/lib/dates';
import { runReminderSweep } from '@/services/reminder.service';

/**
 * The clock that makes the chase happen — now the FALLBACK one.
 *
 * ── n8n owns the schedule ──────────────────────────────────────────────────
 * Lane S of `n8n-workflows/master.json` calls
 * POST /api/integrations/n8n/run-job, which runs the same sweep. That is the
 * clock you can see, pause and prove; this one is a timer inside a container
 * that nobody can observe. Set ENABLE_SCHEDULER=false once lane S is active.
 *
 * Leaving both on is harmless — the dedupe key means the second run of a day
 * writes nothing — but two clocks with one owner is a thing nobody remembers a
 * year later, so pick one.
 *
 * ── Why a plain interval and not a queue ───────────────────────────────────
 * Because the database already holds the state. The sweep reads every open
 * task and works out what is owed today; it does not consume a list of things
 * to do. So a missed tick, a restart, or two ticks in a row all converge on
 * the same outcome, and there is no queue to drain, lose or replay. A per-task
 * scheduled job would be the version that silently forgets a deadline when a
 * container is replaced.
 *
 * ── Why the tick is frequent and the message is not ────────────────────────
 * Ticking every half hour and letting the unique dedupe key decide what has
 * already been said means the day's chase still goes out if the container was
 * down at 07:00. The alternative — fire once at a fixed time — misses the
 * whole day if that one moment happens during a deploy.
 *
 * ── Quiet hours are a product decision, not politeness ─────────────────────
 * These messages reach WhatsApp. A system that wakes a project manager at 03:00
 * to tell him about a task due in a week gets muted within a week, and then it
 * is worth nothing on the day it matters.
 */

const TICK_MS = 30 * 60 * 1000;
const SEND_FROM_HOUR = 7;
const SEND_UNTIL_HOUR = 19;

let started = false;

export function localHour(now: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(now);
  return Number.parseInt(hour, 10);
}

export function isWithinSendingHours(now: Date, timeZone: string = DEFAULT_TIMEZONE): boolean {
  const hour = localHour(now, timeZone);
  return hour >= SEND_FROM_HOUR && hour < SEND_UNTIL_HOUR;
}

async function tick(): Promise<void> {
  const now = new Date();
  if (!isWithinSendingHours(now)) return;

  try {
    const result = await runReminderSweep(now);
    if (result.remindersWritten > 0 || result.escalationsRaised > 0) {
      console.info(
        `[scheduler] chase: ${result.remindersWritten} written, ` +
          `${result.escalationsRaised} escalated, ${result.queuedForDelivery} queued`,
      );
    }
  } catch (error) {
    // Never rethrow: an unhandled rejection in a timer takes the server with
    // it, and a failed sweep must not cost people the ability to sign in.
    console.error('[scheduler] reminder sweep failed', error);
  }
}

export function startScheduler(): void {
  if (started) return;

  // `process.env` directly, not the validated `getEnv()`.
  //
  // This runs at module scope in the root layout, which Next also evaluates
  // while collecting page data during a BUILD — where the real secrets are
  // absent by design and `getEnv()` correctly refuses to validate. Reading one
  // flag needs no validation, and forcing it here turned a build into a
  // failure at /_not-found with nothing to do with routing.
  if (process.env.ENABLE_SCHEDULER !== 'true') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  started = true;

  // `unref` so the timer never holds the process open on shutdown.
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();

  console.info('[scheduler] started — reminder sweep every 30 minutes, 07:00 to 19:00 Asia/Dubai');
  void tick();
}
