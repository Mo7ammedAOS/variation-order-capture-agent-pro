import 'server-only';
import { prisma } from '@/lib/prisma';
import { formatDate, todayUtc } from '@/lib/dates';
import { dispatchPendingNotifications } from '@/services/notification.service';
import { recordAudit } from '@/services/audit-log.service';

/**
 * Chasing the client for an answer on a submitted variation.
 *
 * ── The only thing in this system that writes to somebody outside ─────────
 * Everything else here is addressed to staff. This is not, and that changes
 * what care is owed. A reminder to a colleague that fires twice is an
 * annoyance; a chasing letter to a main contractor's QS that fires twice, or
 * fires after they answered, is a relationship. So three rules hold:
 *
 *   1. It stops the moment they answer. The query, not a flag, is what stops
 *      it — a VO whose `clientResponse` has moved off `awaiting` cannot be
 *      selected, so there is no path where a stale flag keeps writing.
 *   2. One message per variation per interval, enforced by the dedupe key. A
 *      sweep that runs twice in a day sends once.
 *   3. It states facts and asks a question. No pressure, no escalation
 *      language, no threat of a claim. The reference, the date, the value,
 *      and "please confirm". A contractor who receives a rude chase remembers
 *      it for the rest of the job.
 *
 * ── The cadence belongs to the company, not to this file ──────────────────
 * Osman's call, 2026-09-02: chasing is a commercial posture, not a system
 * behaviour. On one contract the QS chases in person and an automated letter
 * would cut across him; on another nothing moves without a written trail. So
 * both the switch and the interval sit in the project's contract rules, and
 * this sweep only reads them:
 *
 *   `clientFollowUpEnabled`  off means silence, and off is a real answer
 *   `clientFollowUpDays`     days between one chase and the next; 7 is weekly
 *   `voResponseDays`         the client's own period — nothing before it runs
 *
 * This replaces a fixed Monday. A fixed weekday was the right default and the
 * wrong rule: it made a seven-day cadence unchangeable, and the field that
 * claimed to change it did nothing.
 *
 * ── Why the schedule can now be daily ─────────────────────────────────────
 * The interval is enforced HERE, by the window arithmetic below, not by how
 * often n8n fires. The sweep is idempotent: running it hourly, daily, or twice
 * on the same morning produces the same letters, because the dedupe key names
 * the interval window rather than the run. That is deliberate — the schedule
 * is the least trustworthy part of the stack and the easiest to edit by
 * accident, so it is not allowed to decide anything.
 *
 * ── What it does NOT do ───────────────────────────────────────────────────
 * It does not chase a variation that has not been submitted, or one the
 * client has answered in any way — including "we need more information",
 * which is an answer and needs a person, not another chase.
 */

/** Used when a project has no contract rules row at all. */
const FALLBACK_RESPONSE_DAYS = 14;
const FALLBACK_INTERVAL_DAYS = 7;

export interface ClientChaseDecision {
  /** Whether a chase is owed for this variation today. */
  due: boolean;
  /**
   * Which interval since the client fell due this chase belongs to. Window 0
   * is the first one, on the day the response period expires. It goes into the
   * dedupe key, and that is what makes the interval real: a second sweep
   * inside the same window computes the same key and writes nothing.
   */
  window: number;
}

/**
 * Is a chase owed, and which one is it?
 *
 * Pure, so the cadence can be tested without a database — this is the part
 * that decides whether a real client hears from us, and it should be provable
 * by reading rather than by watching an inbox.
 */
export function clientChaseDue(input: {
  enabled: boolean;
  /** Days since the variation was submitted. */
  waitingDays: number;
  /** The client's own response period. Nothing is chased inside it. */
  responseDays: number;
  /** Days between chases. */
  intervalDays: number;
}): ClientChaseDecision {
  if (!input.enabled) return { due: false, window: -1 };

  // Nothing is chased before the client's own response period has run. A
  // reminder on day three is not diligence, it is nagging, and it teaches
  // them to ignore the one on day thirty.
  const overdueDays = input.waitingDays - input.responseDays;
  if (overdueDays < 0) return { due: false, window: -1 };

  // A zero or negative interval would mean "every zero days", which is not a
  // cadence. The field is validated at 1–90 on the way in; this is the
  // backstop for a row that predates that or was written by hand.
  const interval = input.intervalDays >= 1 ? Math.floor(input.intervalDays) : FALLBACK_INTERVAL_DAYS;

  return { due: true, window: Math.floor(overdueDays / interval) };
}

export interface ClientFollowUpResult {
  /** Variations sitting unanswered with the client. */
  awaiting: number;
  /** Chases written this run. */
  written: number;
  queuedForDelivery: number;
  /** Projects that have switched chasing off, and were skipped for that reason. */
  skippedDisabled: number;
}

/**
 * Writes one chase per variation whose interval has come round.
 *
 * Safe to run as often as you like. The interval, not the schedule, decides
 * what goes out.
 */
export async function runClientFollowUp(now: Date = new Date()): Promise<ClientFollowUpResult> {
  const today = todayUtc(now);

  const orders = await prisma.variationOrder.findMany({
    where: {
      status: 'submitted',
      // The answer is what stops the chase, and it is expressed here rather
      // than as a check inside the loop so there is no path that keeps
      // chasing a variation somebody has already replied to.
      clientResponse: 'awaiting',
      submittedAt: { not: null },
      project: { projectStatus: { in: ['active', 'awarded'] } },
    },
    select: {
      id: true,
      voNumber: true,
      title: true,
      submittedValue: true,
      submittedAt: true,
      potentialChangeId: true,
      projectId: true,
      project: {
        select: {
          projectCode: true,
          projectName: true,
          currency: true,
          contractRules: {
            select: {
              voResponseDays: true,
              clientFollowUpDays: true,
              clientFollowUpEnabled: true,
            },
          },
          contacts: {
            where: {
              active: true,
              contactType: { in: ['client', 'client_representative'] },
              email: { not: null },
            },
            select: { id: true, fullName: true, email: true, contactType: true },
            orderBy: { contactType: 'asc' },
          },
        },
      },
    },
  });

  let written = 0;
  let skippedDisabled = 0;

  for (const vo of orders) {
    const recipient = vo.project.contacts[0];
    // No client contact is not an error to throw — it is a gap in the project
    // set-up, and it stops this one chase rather than the whole sweep.
    if (!recipient?.email || !vo.submittedAt) continue;

    const rules = vo.project.contractRules;
    const waitingDays = Math.floor(
      (today.getTime() - todayUtc(vo.submittedAt).getTime()) / 86_400_000,
    );

    const decision = clientChaseDue({
      enabled: rules?.clientFollowUpEnabled ?? true,
      waitingDays,
      responseDays: rules?.voResponseDays ?? FALLBACK_RESPONSE_DAYS,
      intervalDays: rules?.clientFollowUpDays ?? FALLBACK_INTERVAL_DAYS,
    });

    if (rules && !rules.clientFollowUpEnabled) skippedDisabled += 1;
    if (!decision.due) continue;

    const value = vo.submittedValue
      ? `${vo.project.currency ?? 'AED'} ${vo.submittedValue.toString()}`
      : null;

    const body = [
      `Dear ${recipient.fullName},`,
      '',
      `We are following up on variation ${vo.voNumber} on ${vo.project.projectCode} — ${vo.project.projectName}.`,
      '',
      `Subject: ${vo.title}`,
      value ? `Value submitted: ${value}` : null,
      `Submitted: ${formatDate(vo.submittedAt)} (${waitingDays} days ago)`,
      '',
      'We have not yet received your response. Could you confirm the position, or let us know what further information you need.',
      '',
      'Kind regards',
    ]
      .filter((line) => line !== null)
      .join('\n');

    const result = await prisma.notificationLog.createMany({
      data: [
        {
          potentialChangeId: vo.potentialChangeId,
          // No `userId`: the addressee is the client. A chase must never turn
          // up in a colleague's notification bell as though it were his task.
          kind: 'client_followup',
          channel: 'email',
          recipient: recipient.email,
          subject: `Variation ${vo.voNumber} — ${vo.project.projectCode} — awaiting your response`,
          body,
          payloadSummary: vo.voNumber,
          status: 'pending',
          // The interval window, not the date. `skipDuplicates` on the unique
          // key is what turns "every 7 days" from an intention into a
          // guarantee: every sweep inside window 3 computes this same string,
          // and only the first one writes a row.
          dedupeKey: `client-chase:${vo.id}:w${decision.window}`,
        },
      ],
      skipDuplicates: true,
    });

    if (result.count > 0) {
      written += result.count;
      await recordAudit({
        db: prisma,
        projectId: vo.projectId,
        userId: null,
        recordType: 'variation_order',
        recordId: vo.id,
        actionType: 'updated',
        newValue: {
          clientChase: recipient.email,
          waitingDays,
          voNumber: vo.voNumber,
        },
        source: 'system',
        metadata: {
          window: decision.window,
          intervalDays: rules?.clientFollowUpDays ?? FALLBACK_INTERVAL_DAYS,
        },
      });
    }
  }

  const delivery = await dispatchPendingNotifications();

  return {
    awaiting: orders.length,
    written,
    queuedForDelivery: delivery.queued,
    skippedDisabled,
  };
}
