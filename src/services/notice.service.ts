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
import { openGate } from '@/services/approval.service';
import { assertProjectAccess } from '@/services/project-access.service';

/**
 * Notice control.
 *
 * The single most consequential rule in the product, restated here because it
 * is easy to erode one convenience at a time:
 *
 *   NOTICE SENT IS NOT CLIENT APPROVED.
 *
 * Phase 1 assesses and tracks. It does not draft automatically, does not send,
 * and never decides entitlement — a human marks Required, Not Required, or
 * Needs More Information, and the system records who and when.
 */

export const noticeAssessmentSchema = z.object({
  outcome: z.enum(['required', 'not_required', 'needs_more_information']),
  notes: z.string().trim().max(4000).optional(),
});

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

  // Assessing entitlement is a Commercial Manager / Contract Administrator act.
  // A Site Engineer who raised the change cannot answer their own question.
  await assertProjectAccess(user, change.projectId, 'potentialChange.assessNotice');

  const rules = change.project.contractRules;
  // The first stage after the assessment is scope review, so the clock that
  // matters here is the PM's, not the QS's. Reading qsPricingDueDays would give
  // the PM the QS's allowance, and the change would look late or early for
  // reasons nobody could trace back to a setting.
  const scopeDueDays = rules?.pmScopeReviewDueDays ?? 3;

  return prisma.$transaction(async (tx) => {
    const nextDue = new Date(todayUtc());
    nextDue.setUTCDate(nextDue.getUTCDate() + scopeDueDays);

    const updates: Prisma.PotentialChangeUpdateInput = {
      noticeStatus: input.outcome,
      noticeRequired: input.outcome === 'required',
      noticeAssessedAt: new Date(),
      noticeAssessedByUserId: user.id,
      noticeAssessmentNotes: input.notes ?? null,
    };

    if (input.outcome === 'required') {
      // The notice is not sent because one person decided it should be. Two
      // seats have to agree before anything reaches the client, because a
      // notice states a contractual position in the company's name.
      updates.currentStatus = 'notice_required';
      updates.waitingFor = 'Approval to issue the notice';
      updates.nextAction = 'Project manager and managing director must approve issuing it';
    } else if (input.outcome === 'not_required') {
      // No notice needed does not mean no change. It goes into the commercial
      // chain at the top of it — scope first.
      //
      // This used to route straight to QS pricing, which skipped scope review
      // entirely and meant a change that needed no notice was priced against
      // whatever the original message happened to say. Osman settled the order
      // on 2026-08-30: the PM defines the change, then the QS prices what was
      // defined. The status guard now forbids the skip, so leaving this pointing
      // at qs_pricing would have put changes into a state the chain says they
      // could not have reached.
      updates.currentStatus = 'pm_scope_review';
      updates.waitingFor = 'PM scope review';
      updates.nextAction = 'Define the scope of the change';
      updates.nextActionDueDate = nextDue;
    } else {
      updates.currentStatus = 'needs_evidence';
      updates.waitingFor = 'Missing information';
      updates.nextAction = 'Provide the missing evidence';
      updates.blockerReason = input.notes ?? 'Assessor needs more information';
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
      await openGate(tx, {
        potentialChangeId,
        projectId: change.projectId,
        gate: 'notice_issue',
        pcNumber: change.pcNumber,
        title: change.title,
        dueDate: nextDue,
        openedByUserId: user.id,
      });
    }

    if (input.outcome === 'not_required') {
      // Scope review, raised for the PM. It used to raise QS pricing for the
      // QS, which sent the change to one person and the work to another.
      const pm = await tx.projectMember.findFirst({
        where: { projectId: change.projectId, active: true, projectRole: 'project_manager' },
        select: { userId: true },
      });
      const reviewTask = await tx.task.create({
        data: {
          projectId: change.projectId,
          potentialChangeId,
          taskType: 'pm_scope_review',
          title: `Scope review — ${change.pcNumber}`,
          assignedToUserId: pm?.userId ?? null,
          assignedByUserId: user.id,
          dueDate: nextDue,
        },
      });

      if (pm?.userId) {
        const reviewRecipients = await tx.user.findMany({
          where: { id: pm.userId, active: true },
          select: { id: true, fullName: true, email: true, phone: true },
        });

        await recordTaskNotifications(tx, {
          taskId: reviewTask.id,
          potentialChangeId,
          kind: 'task_assigned',
          subject: `Scope review needed — ${change.pcNumber}`,
          body: `${change.title}. The notice assessment concluded no notice is required; review the scope.`,
          on: todayUtc(),
          recipients: reviewRecipients.map((r) => ({
            userId: r.id,
            fullName: r.fullName,
            email: r.email,
            phone: r.phone,
          })),
        });
      }
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
      metadata: input.notes ? { notes: input.notes } : undefined,
    });

    return updated;
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

  return prisma.notificationLog.update({
    where: { id: input.notificationId },
    data: {
      status: input.status,
      externalMessageId: input.externalMessageId ?? null,
      failureReason: input.failureReason ?? null,
      sentAt: input.status === 'sent' || input.status === 'delivered' ? new Date() : null,
    },
  });
}
