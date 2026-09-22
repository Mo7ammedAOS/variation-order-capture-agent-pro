import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DeliveryStatus, NoticeStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { calculateNoticeDueDate, todayUtc } from '@/lib/dates';
import { calculateNoticeCountdown, type NoticeCountdown } from '@/lib/risk';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit } from '@/services/audit-log.service';
import { recordTaskNotifications } from '@/services/notification.service';
import { enterStage, raiseStageTask } from '@/services/stage.service';
import { assertProjectAccess } from '@/services/project-access.service';
import { draftNotice, markNoticeDelivered } from '@/services/notice-document.service';
import { getAiProvider } from '@/integrations/claude';
import { CONFIDENCE_REVIEW_THRESHOLD } from '@/integrations/claude/provider';
import {
  NOTICE_NOT_REQUIRED_REASONS,
  type NoticeNotRequiredReason,
} from '@/lib/notice-reasons';

/**
 * Notice control.
 *
 * The single most consequential rule in the product, restated here because it
 * is easy to erode one convenience at a time:
 *
 *   NOTICE SENT IS NOT CLIENT APPROVED.
 *
 * The project manager decides, on one screen, whether a notice is required.
 * The system never decides entitlement: a human marks Required, Not Required or
 * Needs More Information, and the system records who, when and why.
 *
 * ── Deciding is not sending ────────────────────────────────────────────────
 * Answering "required" drafts a notice and nothing else. It is sent by a second,
 * deliberate act on the draft itself (`sendNotice`), so that what goes to the
 * client is a page of words somebody read, not an intention somebody had.
 *
 * ── The notice does not hold up the money ──────────────────────────────────
 * Pricing starts the moment the decision is made, in parallel with drafting,
 * sending and acknowledgement. The notice exists to protect entitlement inside
 * a contractual window; making the QS wait for it spends the very days it was
 * trying to save. The two run on separate axes: `currentStatus` follows the
 * commercial chain, `noticeStatus` and the Notice row follow the notice.
 */

export { NOTICE_NOT_REQUIRED_REASONS };
export type { NoticeNotRequiredReason };

const notes = z.string().trim().max(4000).optional();

export const noticeAssessmentSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('required'), notes }),
  z.object({
    outcome: z.literal('not_required'),
    // Required, deliberately. A PM cannot answer "no" and walk away.
    reason: z.enum(NOTICE_NOT_REQUIRED_REASONS, {
      errorMap: () => ({ message: 'Choose why no notice is required' }),
    }),
    notes,
  }),
  z.object({
    outcome: z.literal('needs_more_information'),
    missingInformation: z
      .string()
      .trim()
      .min(5, 'Say what is missing, so somebody can go and get it'),
    // A checkbox sends "on" when ticked and nothing at all when not, so the
    // default is what decides this, never a cast of the string "false".
    allowPricingToContinue: z
      .union([z.literal('on'), z.literal('true'), z.boolean()])
      .optional()
      .transform((value) => value === 'on' || value === 'true' || value === true),
    notes,
  }),
]);

export type NoticeAssessmentInput = z.infer<typeof noticeAssessmentSchema>;

export async function assessNotice(
  user: AuthenticatedUser,
  potentialChangeId: string,
  input: NoticeAssessmentInput,
) {
  const change = await prisma.potentialChange.findUnique({
    where: { id: potentialChangeId },
    include: { project: { include: { contractRules: true } } },
  });
  if (!change) throw new NotFoundError('Potential Change not found');

  // Assessing entitlement is the project manager's act, resolved by capability
  // rather than by job title. A Site Engineer who raised the change cannot
  // answer their own question.
  await assertProjectAccess(user, change.projectId, 'potentialChange.assessNotice');

  const rules = change.project.contractRules;
  // How long the reporter has to come back with what is missing. The QS's own
  // allowance is set by the pricing stage and is not this number.
  const infoDueDays = rules?.pmScopeReviewDueDays ?? 3;

  // The notice wording, drafted BEFORE the transaction opens.
  //
  // Out here for two reasons. It is a network call, and the transaction below
  // holds row locks on a five second budget — a slow afternoon at the provider
  // would start rolling back assessments. And it is optional: if it throws, or
  // returns something the schema refuses, the notice is still drafted, still
  // quoting the reporter's own words exactly as it did before. A notice must
  // never fail to exist because a rewrite failed.
  const narrative =
    input.outcome === 'required'
      ? await draftNarrative({
          description: change.description ?? '',
          title: change.title,
          trade: change.trade,
          location: change.location,
          instructedBy: null,
        })
      : null;

  return prisma.$transaction(async (tx) => {
    const infoDue = new Date(todayUtc());
    infoDue.setUTCDate(infoDue.getUTCDate() + infoDueDays);

    const updates: Prisma.PotentialChangeUpdateInput = {
      noticeStatus: input.outcome,
      noticeRequired: input.outcome === 'required',
      noticeAssessedAt: new Date(),
      noticeAssessedByUserId: user.id,
      noticeAssessmentNotes: input.notes ?? null,
      noticeNotRequiredReason: input.outcome === 'not_required' ? input.reason : null,
      noticeMissingInformation:
        input.outcome === 'needs_more_information' ? input.missingInformation : null,
    };

    // Required and not-required both go straight to pricing. The difference
    // between them is a notice being drafted beside the work, not a different
    // route through it.
    const goesToPricing =
      input.outcome === 'required' ||
      input.outcome === 'not_required' ||
      (input.outcome === 'needs_more_information' && input.allowPricingToContinue);

    if (input.outcome === 'needs_more_information') {
      // The change stays with the PM. Pricing may run beside it if the PM said
      // so, but the review is not finished and the record must not read as if
      // it were.
      updates.currentStatus = 'needs_evidence';
      updates.waitingFor = 'Missing information';
      updates.nextAction = `Provide: ${input.missingInformation}`;
      updates.nextActionDueDate = infoDue;
      updates.blockerReason = input.missingInformation;
      updates.pricingStartedEarly = input.allowPricingToContinue;
    } else {
      updates.currentStatus = 'qs_pricing';
      if (input.outcome === 'required') {
        // The draft is written below. It is not sent by this decision.
        updates.noticeStatus = 'drafted';
      }
    }

    const updated = await tx.potentialChange.update({
      where: { id: potentialChangeId },
      data: updates,
    });

    // Close the assessment task, then raise whatever comes next, so the work
    // always has a named owner rather than falling into a gap between stages.
    await tx.task.updateMany({
      where: { potentialChangeId, taskType: 'notice_assessment', status: { in: ['open', 'in_progress'] } },
      data: { status: 'completed', completedAt: new Date() },
    });

    if (input.outcome === 'required') {
      await draftNotice(tx, {
        potentialChangeId,
        projectId: change.projectId,
        actorUserId: user.id,
        narrative,
      });
    }

    if (input.outcome === 'needs_more_information') {
      // Somebody has to go and get it. Assigned to whoever reported the change,
      // because they were there, quoting the PM's words back rather than a
      // paraphrase of them.
      await raiseEvidenceTask(tx, {
        change,
        missingInformation: input.missingInformation,
        actorUserId: user.id,
        due: infoDue,
      });
    }

    if (goesToPricing) {
      const stageInput = {
        potentialChangeId,
        projectId: change.projectId,
        pcNumber: change.pcNumber,
        title: change.title,
        status: 'qs_pricing' as const,
        actorUserId: user.id,
        note:
          input.outcome === 'needs_more_information'
            ? `Priced while information is still outstanding: ${input.missingInformation}`
            : undefined,
      };

      // When information is still outstanding the QS gets the task but the
      // change keeps saying what it is really waiting for. `enterStage` would
      // overwrite that headline with "QS pricing" and hide the gap.
      await (input.outcome === 'needs_more_information'
        ? raiseStageTask(tx, stageInput)
        : enterStage(tx, stageInput));
    }

    await recordAudit({
      db: tx,
      projectId: change.projectId,
      userId: user.id,
      recordType: 'potential_change',
      recordId: potentialChangeId,
      actionType:
        input.outcome === 'required'
          ? 'notice_required'
          : input.outcome === 'not_required'
            ? 'notice_not_required'
            : 'notice_needs_information',
      oldValue: { noticeStatus: change.noticeStatus },
      newValue: { noticeStatus: input.outcome, noticeRequired: input.outcome === 'required' },
      metadata: {
        ...(input.notes ? { notes: input.notes } : {}),
        ...(input.outcome === 'not_required' ? { reason: input.reason } : {}),
        ...(input.outcome === 'needs_more_information'
          ? {
              missingInformation: input.missingInformation,
              pricingContinued: input.allowPricingToContinue,
            }
          : {}),
      },
    });

    return updated;
  });
}

/**
 * The "go and find out" task, raised for whoever reported the change.
 *
 * Falls back to the change's current owner when the report came in through a
 * channel with no named sender. A task nobody holds is worse than one held by
 * the person already carrying the change.
 */
async function raiseEvidenceTask(
  tx: Prisma.TransactionClient,
  input: {
    change: { id: string; projectId: string; pcNumber: string; title: string; reportedByUserId: string | null; currentOwnerUserId: string | null };
    missingInformation: string;
    actorUserId: string;
    due: Date;
  },
): Promise<void> {
  const assignee = input.change.reportedByUserId ?? input.change.currentOwnerUserId;

  const open = await tx.task.findFirst({
    where: {
      potentialChangeId: input.change.id,
      taskType: 'evidence_collection',
      status: { in: ['open', 'in_progress'] },
    },
    select: { id: true },
  });
  if (open) return;

  const task = await tx.task.create({
    data: {
      projectId: input.change.projectId,
      potentialChangeId: input.change.id,
      taskType: 'evidence_collection',
      title: `Information needed — ${input.change.pcNumber}`,
      description: input.missingInformation,
      assignedToUserId: assignee,
      assignedByUserId: input.actorUserId,
      dueDate: input.due,
    },
  });

  if (!assignee) return;

  const recipients = await tx.user.findMany({
    where: { id: assignee, active: true },
    select: { id: true, fullName: true, email: true, phone: true },
  });

  await recordTaskNotifications(tx, {
    taskId: task.id,
    potentialChangeId: input.change.id,
    kind: 'task_assigned',
    subject: `Information needed — ${input.change.pcNumber}`,
    body: `${input.change.title}. The project manager needs: ${input.missingInformation}`,
    on: todayUtc(),
    recipients: recipients.map((r) => ({
      userId: r.id,
      fullName: r.fullName,
      email: r.email,
      phone: r.phone,
    })),
  });
}

export function getNoticeCountdown(
  noticeDueDate: Date | null,
  amberThresholdDays = 7,
): NoticeCountdown {
  return calculateNoticeCountdown(noticeDueDate, { amberThresholdDays });
}

/**
 * The notice statuses that still leave a deadline live.
 *
 * Once a notice is drafted, sent or acknowledged, the deadline has been met and
 * a passed date is history rather than a breach. Exported because the dashboard,
 * the register and the printed report all have to answer "is this overdue" the
 * same way — a report that disagrees with the dashboard about how many notices
 * are late is worse than having no report, because now nobody trusts either.
 */
export const NOTICE_OUTSTANDING_STATUSES = ['not_assessed', 'required'] as const;

export function isNoticeOverdue(
  noticeDueDate: Date | null,
  noticeStatus: NoticeStatus,
  today: Date,
): boolean {
  if (!noticeDueDate) return false;
  if (!(NOTICE_OUTSTANDING_STATUSES as readonly string[]).includes(noticeStatus)) return false;
  return noticeDueDate.getTime() < today.getTime();
}

export function recalculateNoticeDueDate(eventDate: Date, noticePeriodDays: number): Date {
  return calculateNoticeDueDate(eventDate, noticePeriodDays);
}

/**
 * The delivery state machine.
 *
 * A notification is created `pending`. It becomes `sent` ONLY when the courier
 * reports back. If the send fails it becomes `failed` and a retry is raised —
 * it never becomes "sent" because we asked for it to be sent. An external
 * failure must never change business truth.
 */
export async function requestNotification(input: {
  potentialChangeId?: string | null;
  channel: 'email' | 'whatsapp' | 'in_app';
  recipient: string;
  subject?: string;
  payloadSummary?: string;
  db?: Prisma.TransactionClient;
  /**
   * Supply this for anything that can legitimately be asked for twice — a
   * scheduled chase, a retried webhook — and the unique index refuses the
   * second copy. One-off requests get a random key, because two deliberate
   * sends of the same notice are two notices.
   */
  dedupeKey?: string;
}) {
  const db = input.db ?? prisma;
  return db.notificationLog.create({
    data: {
      potentialChangeId: input.potentialChangeId ?? null,
      channel: input.channel,
      recipient: input.recipient,
      subject: input.subject ?? null,
      payloadSummary: input.payloadSummary ?? null,
      status: 'pending',
      dedupeKey: input.dedupeKey ?? randomUUID(),
    },
  });
}

export async function recordDeliveryResult(input: {
  notificationId: string;
  status: DeliveryStatus;
  externalMessageId?: string | null;
  failureReason?: string | null;
}) {
  const existing = await prisma.notificationLog.findUnique({
    where: { id: input.notificationId },
  });
  if (!existing) throw new NotFoundError('Notification not found');

  if (input.status === 'sent' || input.status === 'delivered') {
    if (!input.externalMessageId) {
      // "Sent" with nothing to point at is not evidence of delivery, and this
      // record may later be the proof that a notice was served.
      throw new ValidationError('A successful delivery must carry an external message id');
    }
  }

  const updated = await prisma.notificationLog.update({
    where: { id: input.notificationId },
    data: {
      status: input.status,
      externalMessageId: input.externalMessageId ?? null,
      failureReason: input.failureReason ?? null,
      sentAt: input.status === 'sent' || input.status === 'delivered' ? new Date() : null,
    },
  });

  // If this message was carrying a notice, the callback is the proof of
  // service. Most callbacks are for routine reminders and match no notice.
  await markNoticeDelivered({
    notificationId: input.notificationId,
    externalMessageId: input.externalMessageId ?? null,
    succeeded: input.status === 'sent' || input.status === 'delivered',
  });

  return updated;
}

/**
 * The notice wording, or nothing.
 *
 * Every failure path returns null and the notice falls back to quoting the
 * report verbatim — which is what it did for months and is never wrong, only
 * plainer. The one case that is NOT a failure but still returns null is the
 * model telling us it could not keep to the facts: `facts_all_from_report`
 * comes back false, confidence drops, and prose that may contain an invented
 * fact is exactly the prose that must not reach a contractual document.
 */
async function draftNarrative(input: {
  description: string;
  title: string;
  trade: string | null;
  location: string | null;
  instructedBy: string | null;
}): Promise<string | null> {
  const source = input.description.trim();
  // Nothing to improve. A one-line report reads better as itself than as three
  // paragraphs of business English wrapped around six words.
  if (source.length < 40) return null;

  try {
    const envelope = await getAiProvider().draftNoticeNarrative(input);
    const narrative = envelope.extractedData.narrative.trim();
    if (!narrative || envelope.confidenceScore < CONFIDENCE_REVIEW_THRESHOLD) return null;
    return narrative;
  } catch {
    // Swallowed deliberately, and it is the only place in this service that
    // swallows anything. The alternative is an assessment that fails because a
    // rewrite did.
    return null;
  }
}
