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
 *   2. One message per variation per week, enforced by the dedupe key. A
 *      sweep that runs twice on a Monday sends once.
 *   3. It states facts and asks a question. No pressure, no escalation
 *      language, no threat of a claim. The reference, the date, the value,
 *      and "please confirm". A contractor who receives a rude chase remembers
 *      it for the rest of the job.
 *
 * ── Why weekly, and why a fixed day ───────────────────────────────────────
 * Osman's call, 2026-09-02. Weekly is often enough to stay on the pile and
 * rare enough not to be filtered. A fixed day matters more than the interval:
 * a chase that lands every Monday morning becomes part of the recipient's
 * week, where one arriving at a random hour reads as an automated system
 * nobody is watching.
 *
 * ── What it does NOT do ───────────────────────────────────────────────────
 * It does not chase a variation that has not been submitted, or one the
 * client has answered in any way — including "we need more information",
 * which is an answer and needs a person, not another chase.
 */

/** Monday. `Date.getUTCDay()` numbering, where Sunday is 0. */
const DEFAULT_CHASE_DAY = 1;

export interface ClientFollowUpResult {
  /** Variations sitting unanswered with the client. */
  awaiting: number;
  /** Chases written this run. */
  written: number;
  queuedForDelivery: number;
  /** True when today is not the chase day, and nothing was written. */
  skippedWrongDay: boolean;
}

/**
 * Writes one chase per unanswered variation, on the chase day only.
 *
 * `force` exists for the "send it now" button and for tests. It skips the day
 * check and nothing else — the dedupe key still holds, so pressing it twice on
 * a Monday sends once.
 */
export async function runClientFollowUp(
  now: Date = new Date(),
  options: { chaseDay?: number; force?: boolean } = {},
): Promise<ClientFollowUpResult> {
  const today = todayUtc(now);
  const chaseDay = options.chaseDay ?? DEFAULT_CHASE_DAY;

  if (!options.force && today.getUTCDay() !== chaseDay) {
    return { awaiting: 0, written: 0, queuedForDelivery: 0, skippedWrongDay: true };
  }

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
          contractRules: { select: { voResponseDays: true } },
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

  for (const vo of orders) {
    const recipient = vo.project.contacts[0];
    // No client contact is not an error to throw — it is a gap in the project
    // set-up, and it stops this one chase rather than the whole sweep.
    if (!recipient?.email || !vo.submittedAt) continue;

    const waitingDays = Math.floor(
      (today.getTime() - todayUtc(vo.submittedAt).getTime()) / 86_400_000,
    );
    const allowed = vo.project.contractRules?.voResponseDays ?? 14;

    // Nothing is chased before the client's own response period has run. A
    // reminder on day three is not diligence, it is nagging, and it teaches
    // them to ignore the one on day thirty.
    if (waitingDays < allowed) continue;

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

    // One per variation per week. The week number, not the date, so a sweep
    // that runs late on Tuesday does not send a second one.
    const week = `${today.getUTCFullYear()}-${isoWeek(today)}`;

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
          // One per variation per calendar week. `skipDuplicates` on the
          // unique key is what makes a second sweep on the same Monday a
          // no-op rather than a second letter.
          dedupeKey: `client-chase:${vo.id}:${week}`,
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
        metadata: { week },
      });
    }
  }

  const delivery = await dispatchPendingNotifications();

  return {
    awaiting: orders.length,
    written,
    queuedForDelivery: delivery.queued,
    skippedWrongDay: false,
  };
}

/** ISO week number, so a chase is one per calendar week rather than per 7 days. */
function isoWeek(date: Date): number {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}
