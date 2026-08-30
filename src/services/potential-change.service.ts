import 'server-only';
import type { Prisma, PotentialChangeStatus, RiskLevel } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { calculateNoticeDueDate, todayUtc } from '@/lib/dates';
import { calculateNoticeCountdown } from '@/lib/risk';
import { formatPcNumber } from '@/lib/pc-number';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit, diffChanges } from '@/services/audit-log.service';
import { assertProjectAccess, scopeToUser } from '@/services/project-access.service';
import { pickResponsibleMember } from '@/services/permissions.service';
import { loadRecipients, recordTaskNotifications } from '@/services/notification.service';
import { NOTICE_ASSESSMENT_PREFERENCE } from '@/lib/rbac';

/**
 * The Potential Change register — the heart of the system.
 *
 * The order of operations on creation is contractual, not arbitrary:
 *
 *   1. allocate a PC number       so the change is referenceable immediately
 *   2. calculate the notice due   so the clock starts at capture, not at review
 *   3. assign PM and CM           so it has an owner before anyone goes home
 *   4. raise Notice Assessment    so somebody is asked the entitlement question
 *
 * Capture the event immediately. Assess notice risk immediately. Price and
 * prove the change in parallel.
 */

/** `qs_pricing` reads as "QS pricing" in a message, not as a column name. */
function humaniseStatus(status: PotentialChangeStatus): string {
  return status.replace(/_/g, ' ');
}

export const potentialChangeCreateSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(3, 'Describe the change in a few words').max(200),
  description: z.string().trim().min(3, 'Say what changed').max(5000),
  eventDate: z.coerce.date(),
  location: z.string().trim().max(200).optional().nullable(),
  trade: z.string().trim().max(100).optional().nullable(),
  category: z.string().trim().max(100).optional().nullable(),
  workStatus: z.enum(['not_started', 'in_progress', 'completed', 'on_hold']).default('not_started'),
  estimatedValue: z.coerce.number().nonnegative().optional().nullable(),
  potentialTimeImpact: z.boolean().default(false),
  timeImpactDays: z.coerce.number().int().nonnegative().optional().nullable(),
  sourceType: z
    .enum([
      'mobile_form', 'whatsapp', 'email', 'document_upload',
      'meeting', 'meeting_online', 'site_instruction', 'verbal', 'other',
    ])
    .default('mobile_form'),
  /**
   * Where and when the change was RAISED, which is not where and when it
   * happened. `location` and `eventDate` describe the change itself; these
   * describe the conversation that surfaced it — the meeting room, the video
   * platform, the WhatsApp group, and the moment somebody first said so.
   *
   * They matter because a verbal instruction is only as good as the record of
   * it, and "who told us, where were we, and when" is precisely what gets
   * challenged. The gap between `sourceOccurredAt` and `eventDate` is itself
   * evidence: a change raised three weeks after it happened tells you something
   * about the notice risk before anyone assesses it.
   */
  sourceLocation: z.string().trim().max(200).optional().nullable(),
  // `.optional()` belongs INSIDE the preprocess. Outside it, a blank field is
  // turned into undefined and then handed to z.coerce.date() anyway, which
  // makes an Invalid Date and rejects — so leaving an optional field empty,
  // which the form explicitly invites, would fail validation.
  sourceOccurredAt: z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.coerce.date().optional(),
  ),
  sourceReference: z.string().trim().max(200).optional().nullable(),
  sourceMessageId: z.string().trim().max(200).optional().nullable(),
  sourceSenderName: z.string().trim().max(200).optional().nullable(),
  sourceSenderPhoneOrEmail: z.string().trim().max(200).optional().nullable(),
  requestedByContactId: z.string().uuid().optional().nullable(),
  /** Free-text urgency from the mobile form, mapped to task priority. */
  urgency: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
});

export type PotentialChangeCreateInput = z.infer<typeof potentialChangeCreateSchema>;

export const potentialChangeFilterSchema = z.object({
  projectId: z.string().uuid().optional(),
  status: z.string().optional(),
  riskLevel: z.enum(['green', 'amber', 'red']).optional(),
  ownerUserId: z.string().uuid().optional(),
  trade: z.string().optional(),
  search: z.string().optional(),
  noticeDueWithinDays: z.coerce.number().int().optional(),
});

export type PotentialChangeFilter = z.infer<typeof potentialChangeFilterSchema>;

export async function listPotentialChanges(
  user: AuthenticatedUser,
  filters: PotentialChangeFilter = {},
) {
  const scope = await scopeToUser(user);

  const where: Prisma.PotentialChangeWhereInput = { ...scope };

  // A requested project must still pass the scope check. Narrowing an already
  // scoped query is safe; replacing the scope with the request would not be.
  if (filters.projectId) {
    await assertProjectAccess(user, filters.projectId);
    where.projectId = filters.projectId;
  }
  if (filters.status) where.currentStatus = filters.status as PotentialChangeStatus;
  if (filters.riskLevel) where.riskLevel = filters.riskLevel;
  if (filters.ownerUserId) where.currentOwnerUserId = filters.ownerUserId;
  if (filters.trade) where.trade = filters.trade;
  if (filters.search) {
    where.OR = [
      { pcNumber: { contains: filters.search, mode: 'insensitive' } },
      { title: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } },
    ];
  }
  if (filters.noticeDueWithinDays !== undefined) {
    const limit = new Date(todayUtc());
    limit.setUTCDate(limit.getUTCDate() + filters.noticeDueWithinDays);
    where.noticeDueDate = { lte: limit };
  }

  return prisma.potentialChange.findMany({
    where,
    orderBy: [{ noticeDueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
    include: {
      project: { select: { id: true, projectCode: true, projectName: true } },
      currentOwner: { select: { id: true, fullName: true } },
      requestedByContact: { select: { id: true, fullName: true, authorityVerified: true } },
      _count: { select: { tasks: true, documents: true, bottlenecks: true } },
    },
  });
}

export async function getPotentialChange(user: AuthenticatedUser, id: string) {
  const change = await prisma.potentialChange.findUnique({
    where: { id },
    include: {
      project: { include: { contractRules: true } },
      currentOwner: { select: { id: true, fullName: true, email: true } },
      reportedBy: { select: { id: true, fullName: true } },
      requestedByContact: true,
      tasks: {
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
        include: { assignedTo: { select: { id: true, fullName: true } } },
      },
      documents: { orderBy: { createdAt: 'desc' } },
      bottlenecks: { where: { resolvedAt: null }, orderBy: { firstDetectedAt: 'asc' } },
    },
  });

  if (!change) throw new NotFoundError('Potential Change not found');
  // Access is checked AFTER the fetch so we know the project id, but before a
  // single field is returned to the caller.
  await assertProjectAccess(user, change.projectId);

  return change;
}

export async function createPotentialChange(
  user: AuthenticatedUser,
  input: PotentialChangeCreateInput,
) {
  await assertProjectAccess(user, input.projectId, 'potentialChange.create');

  // Resolved BEFORE the transaction, and asked as a capability rather than a
  // role name. Reading the permission matrix is a separate query on the shared
  // client; doing it inside would add a round trip to a transaction that holds
  // a row lock on the project's PC counter.
  const noticeOwner = await pickResponsibleMember(
    input.projectId,
    'potentialChange.assessNotice',
    NOTICE_ASSESSMENT_PREFERENCE,
  );
  const noticeRecipients = await loadRecipients([noticeOwner]);

  const created = await prisma.$transaction(
    async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: input.projectId },
        include: { contractRules: true },
      });
      if (!project) throw new NotFoundError('Project not found');

      // Atomic counter. `MAX(sequence) + 1` races: two site engineers filing at
      // the same moment would both read the same maximum and collide on the
      // unique index. An UPDATE ... RETURNING takes a row lock and cannot.
      const [bumped] = await tx.$queryRaw<{ pc_sequence: number }[]>`
        UPDATE projects SET pc_sequence = pc_sequence + 1
        WHERE id = ${input.projectId}::uuid
        RETURNING pc_sequence
      `;
      if (!bumped) throw new NotFoundError('Project not found');

      const pcNumber = formatPcNumber(project.projectCode, bumped.pc_sequence);

      const noticePeriodDays = project.contractRules?.noticePeriodDays ?? 28;
      const noticeDueDate = calculateNoticeDueDate(input.eventDate, noticePeriodDays);
      const { riskLevel } = calculateNoticeCountdown(noticeDueDate);

      const reviewDueDays = project.contractRules?.pmScopeReviewDueDays ?? 3;
      const nextActionDue = new Date(todayUtc());
      nextActionDue.setUTCDate(nextActionDue.getUTCDate() + reviewDueDays);

      const change = await tx.potentialChange.create({
        data: {
          projectId: input.projectId,
          pcNumber,
          title: input.title,
          description: input.description,
          eventDate: input.eventDate,
          location: input.location ?? null,
          trade: input.trade ?? null,
          category: input.category ?? null,
          workStatus: input.workStatus,
          estimatedValue: input.estimatedValue ?? null,
          potentialTimeImpact: input.potentialTimeImpact,
          timeImpactDays: input.timeImpactDays ?? null,
          sourceType: input.sourceType,
          sourceLocation: input.sourceLocation ?? null,
          sourceOccurredAt: input.sourceOccurredAt ?? null,
          sourceReference: input.sourceReference ?? null,
          sourceMessageId: input.sourceMessageId ?? null,
          sourceSenderName: input.sourceSenderName ?? null,
          sourceSenderPhoneOrEmail: input.sourceSenderPhoneOrEmail ?? null,
          requestedByContactId: input.requestedByContactId ?? null,
          reportedByUserId: user.id,

          currentStatus: 'notice_assessment',
          // The Commercial Manager owns the entitlement question where the
          // project has one. Failing that it goes to whoever else on this
          // project the admin has granted the authority to — and if that is
          // nobody, it stays UNOWNED and shows as a bottleneck, rather than
          // being parked on a person who would find no button to press.
          currentOwnerUserId: noticeOwner,
          waitingFor: 'Notice assessment',
          nextAction: 'Assess whether a contractual notice is required',
          nextActionDueDate: nextActionDue,

          noticeDueDate,
          noticeStatus: 'not_assessed',
          riskLevel,
        },
      });

      const assessmentTask = await tx.task.create({
        data: {
          projectId: input.projectId,
          potentialChangeId: change.id,
          taskType: 'notice_assessment',
          title: `Notice assessment — ${pcNumber}`,
          description:
            `Decide whether a contractual notice is required for "${input.title}". ` +
            `Notice period is ${noticePeriodDays} days from the event date.`,
          assignedToUserId: noticeOwner,
          assignedByUserId: user.id,
          dueDate: nextActionDue,
          priority: input.urgency,
        },
      });

      // Same transaction as the task. If the change is committed, so is the
      // notice of it; if it rolls back, nobody is told about work that does
      // not exist.
      await recordTaskNotifications(tx, {
        taskId: assessmentTask.id,
        potentialChangeId: change.id,
        kind: 'task_assigned',
        subject: `Notice assessment needed — ${pcNumber}`,
        body:
          `${input.title}. Decide whether a contractual notice is required. ` +
          `Notice period is ${noticePeriodDays} days from the event date.`,
        on: todayUtc(),
        recipients: noticeRecipients,
      });

      await recordAudit({
        db: tx,
        projectId: input.projectId,
        userId: user.id,
        recordType: 'potential_change',
        recordId: change.id,
        actionType: 'created',
        newValue: {
          pcNumber,
          title: input.title,
          eventDate: input.eventDate,
          noticeDueDate,
          estimatedValue: input.estimatedValue ?? null,
        },
        source: input.sourceType === 'mobile_form' ? 'mobile_form' : 'web_app',
        metadata: { noticePeriodDays },
      });

      return change;
    },
    {
      // The counter bump below takes a row lock on the project, so concurrent
      // captures on the SAME project serialise here — deliberately, since that
      // is what makes PC numbers collision-free. Prisma's 5s default assumes a
      // local database; this one is a region away, so a handful of simultaneous
      // captures can exceed it while waiting their turn. Correctness beats
      // throughput on a commercial record, so the window is widened rather than
      // the lock loosened.
      maxWait: 15_000,
      timeout: 30_000,
    },
  );

  return created;
}

export const potentialChangeUpdateSchema = potentialChangeCreateSchema
  .partial()
  .omit({ projectId: true, urgency: true });

export async function updatePotentialChange(
  user: AuthenticatedUser,
  id: string,
  input: z.infer<typeof potentialChangeUpdateSchema>,
) {
  const existing = await prisma.potentialChange.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Potential Change not found');
  await assertProjectAccess(user, existing.projectId, 'potentialChange.update');

  return prisma.$transaction(async (tx) => {
    const data: Prisma.PotentialChangeUpdateInput = { ...input };

    // Moving the event date moves the contractual clock with it. Leaving the
    // old deadline in place would be a quietly wrong date on a legal document.
    if (input.eventDate) {
      const rules = await tx.projectContractRule.findUnique({
        where: { projectId: existing.projectId },
      });
      const noticeDueDate = calculateNoticeDueDate(
        input.eventDate,
        rules?.noticePeriodDays ?? 28,
      );
      data.noticeDueDate = noticeDueDate;
      data.riskLevel = calculateNoticeCountdown(noticeDueDate).riskLevel;
    }

    const updated = await tx.potentialChange.update({ where: { id }, data });

    const diff = diffChanges(
      existing as unknown as Record<string, unknown>,
      data as Record<string, unknown>,
    );
    if (diff) {
      await recordAudit({
        db: tx,
        projectId: existing.projectId,
        userId: user.id,
        recordType: 'potential_change',
        recordId: id,
        actionType: 'updated',
        oldValue: diff.oldValue,
        newValue: diff.newValue,
      });
    }

    return updated;
  });
}

/**
 * Which statuses may follow which.
 *
 * Osman settled the commercial chain on 2026-08-30: scope, then price, then
 * commercial review, then approval. The PM pins down what the change actually
 * is before the QS prices it, so nothing is ever priced against a scope nobody
 * has agreed.
 *
 *   new potential change
 *      ↓
 *   notice assessment  ── needs more info ─→  needs evidence ──┐
 *      │                                                       │
 *      │  (only assessNotice moves it; its outcome decides)     │
 *      ↓                                          re-assess ←──┘
 *   notice required  or  PM scope review
 *      ↓
 *   PM scope review → QS pricing → CM review → internal approval
 *      ↓
 *   included in scope
 *
 * Three rules, and each earns its place:
 *
 *   FORWARD, ONE STAGE AT A TIME. You may advance to the next stage, never skip
 *   one. Skipping is how a change reaches "included in scope" without anybody
 *   approving it, which is the failure the approval thresholds exist to prevent.
 *
 *   BACKWARD, ANY DISTANCE. A CM who spots a pricing error can send it back to
 *   the QS, or to the PM if the scope itself was wrong. A strictly forward chain
 *   would leave "cancel" as the only way to correct a mistake, which loses the
 *   change and its history to fix an arithmetic slip.
 *
 *   THE ENTITLEMENT QUESTION IS ANSWERED ONCE. Nothing walks back into
 *   `notice_assessment` — except `needs_evidence`, and that exception is the
 *   point of the state. "Needs more information" parks the question rather than
 *   answering it, so when the evidence arrives it has to go back to be decided.
 *   Without that route a change waiting on evidence would be stuck for good.
 *
 * `cancelled` is reachable from anywhere that is not already an end.
 */
const REVIEW_CHAIN: readonly PotentialChangeStatus[] = [
  'pm_scope_review',
  'qs_pricing',
  'cm_review',
  'internal_approval',
];

const TERMINAL_STATUSES: readonly PotentialChangeStatus[] = ['included_scope', 'cancelled'];

export function allowedNextStatuses(current: PotentialChangeStatus): PotentialChangeStatus[] {
  if (TERMINAL_STATUSES.includes(current)) return [];

  // The entitlement question belongs to the assessment, never to a dropdown.
  if (current === 'notice_assessment') return [];

  if (current === 'new_potential_change') return ['notice_assessment', 'cancelled'];

  // Parked, not answered. The evidence arrived, so ask the question again.
  if (current === 'needs_evidence') return ['notice_assessment', 'cancelled'];

  // A notice has been raised; the change now needs its scope defined.
  if (current === 'notice_required') return ['pm_scope_review', 'cancelled'];

  const position = REVIEW_CHAIN.indexOf(current);
  if (position === -1) return ['cancelled'];

  const forward = REVIEW_CHAIN[position + 1] ?? 'included_scope';
  const rework = REVIEW_CHAIN.slice(0, position);

  return [forward, ...rework, 'cancelled'];
}

export const statusChangeSchema = z.object({
  status: z.enum([
    'new_potential_change', 'notice_assessment', 'notice_required', 'needs_evidence',
    'pm_scope_review', 'qs_pricing', 'cm_review', 'internal_approval',
    'included_scope', 'cancelled',
  ]),
  note: z.string().trim().max(2000).optional(),
});

export type StatusChangeInput = z.infer<typeof statusChangeSchema>;

export async function changeStatus(
  user: AuthenticatedUser,
  id: string,
  status: PotentialChangeStatus,
  note?: string,
) {
  const existing = await prisma.potentialChange.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Potential Change not found');
  await assertProjectAccess(user, existing.projectId, 'potentialChange.changeStatus');

  if (status === existing.currentStatus) {
    throw new ValidationError(`This change is already at ${humaniseStatus(status)}`);
  }

  const allowed = allowedNextStatuses(existing.currentStatus);
  if (!allowed.includes(status)) {
    throw new ValidationError(
      existing.currentStatus === 'notice_assessment'
        ? 'Record the notice assessment first — its outcome decides where this change goes next'
        : TERMINAL_STATUSES.includes(existing.currentStatus)
          ? `This change is ${humaniseStatus(existing.currentStatus)} and cannot be moved on`
          : `A change at ${humaniseStatus(existing.currentStatus)} cannot move to ${humaniseStatus(status)}`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.potentialChange.update({
      where: { id },
      data: { currentStatus: status },
    });

    await recordAudit({
      db: tx,
      projectId: existing.projectId,
      userId: user.id,
      recordType: 'potential_change',
      recordId: id,
      actionType: 'status_changed',
      oldValue: { currentStatus: existing.currentStatus },
      newValue: { currentStatus: status },
      metadata: note ? { note } : undefined,
    });

    return updated;
  });
}

/** Recomputes the RAG colour from the notice clock. Used by the deadline worker. */
export function deriveRiskLevel(noticeDueDate: Date | null, amberThresholdDays: number): RiskLevel {
  return calculateNoticeCountdown(noticeDueDate, { amberThresholdDays }).riskLevel;
}
