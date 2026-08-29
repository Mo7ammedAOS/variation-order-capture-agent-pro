import 'server-only';
import type { Prisma, PotentialChangeStatus, RiskLevel } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { NotFoundError } from '@/lib/errors';
import { calculateNoticeDueDate, todayUtc } from '@/lib/dates';
import { calculateNoticeCountdown } from '@/lib/risk';
import { formatPcNumber } from '@/lib/pc-number';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit, diffChanges } from '@/services/audit-log.service';
import { assertProjectAccess, scopeToUser } from '@/services/project-access.service';

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
      'meeting', 'site_instruction', 'verbal', 'other',
    ])
    .default('mobile_form'),
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

      const { pm, cm } = await findResponsibleMembers(tx, input.projectId);
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
          sourceReference: input.sourceReference ?? null,
          sourceMessageId: input.sourceMessageId ?? null,
          sourceSenderName: input.sourceSenderName ?? null,
          sourceSenderPhoneOrEmail: input.sourceSenderPhoneOrEmail ?? null,
          requestedByContactId: input.requestedByContactId ?? null,
          reportedByUserId: user.id,

          currentStatus: 'notice_assessment',
          // The Commercial Manager owns the entitlement question. If the project
          // has no CM assigned it falls to the PM, and if it has neither it stays
          // unowned and shows as a bottleneck rather than quietly going nowhere.
          currentOwnerUserId: cm ?? pm ?? null,
          waitingFor: 'Notice assessment',
          nextAction: 'Assess whether a contractual notice is required',
          nextActionDueDate: nextActionDue,

          noticeDueDate,
          noticeStatus: 'not_assessed',
          riskLevel,
        },
      });

      await tx.task.create({
        data: {
          projectId: input.projectId,
          potentialChangeId: change.id,
          taskType: 'notice_assessment',
          title: `Notice assessment — ${pcNumber}`,
          description:
            `Decide whether a contractual notice is required for "${input.title}". ` +
            `Notice period is ${noticePeriodDays} days from the event date.`,
          assignedToUserId: cm ?? pm ?? null,
          assignedByUserId: user.id,
          dueDate: nextActionDue,
          priority: input.urgency,
        },
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

export async function changeStatus(
  user: AuthenticatedUser,
  id: string,
  status: PotentialChangeStatus,
  note?: string,
) {
  const existing = await prisma.potentialChange.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Potential Change not found');
  await assertProjectAccess(user, existing.projectId, 'potentialChange.changeStatus');

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

async function findResponsibleMembers(tx: Prisma.TransactionClient, projectId: string) {
  const members = await tx.projectMember.findMany({
    where: {
      projectId,
      active: true,
      projectRole: { in: ['project_manager', 'commercial_manager'] },
    },
    orderBy: { assignedAt: 'asc' },
    select: { userId: true, projectRole: true },
  });

  return {
    pm: members.find((m) => m.projectRole === 'project_manager')?.userId ?? null,
    cm: members.find((m) => m.projectRole === 'commercial_manager')?.userId ?? null,
  };
}
