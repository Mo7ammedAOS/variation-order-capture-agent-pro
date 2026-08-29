import 'server-only';
import type { BottleneckType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError } from '@/lib/errors';
import { daysSince, todayUtc } from '@/lib/dates';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit } from '@/services/audit-log.service';
import { assertProjectAccess, scopeToUser } from '@/services/project-access.service';

/**
 * Bottlenecks answer the questions a director actually asks:
 *
 *   What is blocked? Who owns the next action? How long has it waited?
 *   How much value is at risk? What happens if nobody acts?
 *
 * The APPLICATION detects them. n8n only delivers the message about them.
 */

export async function listBottlenecks(
  user: AuthenticatedUser,
  filters: { projectId?: string; includeResolved?: boolean } = {},
) {
  const scope = await scopeToUser(user);
  const where: Prisma.BottleneckWhereInput = { ...scope };

  if (filters.projectId) {
    await assertProjectAccess(user, filters.projectId);
    where.projectId = filters.projectId;
  }
  if (!filters.includeResolved) where.resolvedAt = null;

  return prisma.bottleneck.findMany({
    where,
    orderBy: [{ riskLevel: 'desc' }, { overdueDays: 'desc' }],
    include: {
      project: { select: { id: true, projectCode: true, projectName: true } },
      potentialChange: { select: { id: true, pcNumber: true, title: true, estimatedValue: true } },
      blockedByUser: { select: { id: true, fullName: true } },
      blockedByContact: { select: { id: true, fullName: true, companyName: true } },
    },
  });
}

/**
 * Idempotent by design. The detection worker runs repeatedly; raising the same
 * blockage twice would inflate every count a director reads. An open bottleneck
 * of the same type on the same change is refreshed, not duplicated.
 */
export async function detectBottleneck(input: {
  projectId: string;
  potentialChangeId?: string | null;
  bottleneckType: BottleneckType;
  blockedByRole?: string | null;
  blockedByUserId?: string | null;
  blockerReason?: string | null;
  since: Date;
  valueAtRisk?: number | null;
  db?: Prisma.TransactionClient;
}) {
  const db = input.db ?? prisma;
  const overdueDays = Math.max(0, daysSince(input.since) ?? 0);
  const riskLevel = overdueDays >= 14 ? 'red' : overdueDays >= 5 ? 'amber' : 'green';

  const existing = await db.bottleneck.findFirst({
    where: {
      projectId: input.projectId,
      potentialChangeId: input.potentialChangeId ?? null,
      bottleneckType: input.bottleneckType,
      resolvedAt: null,
    },
  });

  if (existing) {
    return db.bottleneck.update({
      where: { id: existing.id },
      data: { overdueDays, riskLevel, blockerReason: input.blockerReason ?? existing.blockerReason },
    });
  }

  return db.bottleneck.create({
    data: {
      projectId: input.projectId,
      potentialChangeId: input.potentialChangeId ?? null,
      bottleneckType: input.bottleneckType,
      blockedByRole: input.blockedByRole ?? null,
      blockedByUserId: input.blockedByUserId ?? null,
      blockerReason: input.blockerReason ?? null,
      riskLevel,
      overdueDays,
      valueAtRisk: input.valueAtRisk ?? null,
    },
  });
}

export async function resolveBottleneck(user: AuthenticatedUser, bottleneckId: string) {
  const existing = await prisma.bottleneck.findUnique({ where: { id: bottleneckId } });
  if (!existing) throw new NotFoundError('Bottleneck not found');
  await assertProjectAccess(user, existing.projectId, 'bottleneck.manage');

  return prisma.$transaction(async (tx) => {
    const resolved = await tx.bottleneck.update({
      where: { id: bottleneckId },
      data: { resolvedAt: new Date() },
    });
    await recordAudit({
      db: tx,
      projectId: existing.projectId,
      userId: user.id,
      recordType: 'bottleneck',
      recordId: bottleneckId,
      actionType: 'resolved',
      oldValue: { resolvedAt: null },
      newValue: { resolvedAt: resolved.resolvedAt },
    });
    return resolved;
  });
}

/**
 * The Phase 1 detection sweep. Deliberately narrow — it covers the stages that
 * exist in Phase 1 and nothing beyond. The remaining twenty-odd bottleneck
 * types in the schema arrive with the stages that produce them.
 */
export async function runDetectionSweep(): Promise<{ detected: number }> {
  const today = todayUtc();
  let detected = 0;

  const overdueAssessments = await prisma.potentialChange.findMany({
    where: {
      noticeStatus: 'not_assessed',
      nextActionDueDate: { lt: today },
      currentStatus: { notIn: ['cancelled', 'included_scope'] },
    },
    select: {
      id: true, projectId: true, estimatedValue: true,
      nextActionDueDate: true, currentOwnerUserId: true,
    },
  });

  for (const change of overdueAssessments) {
    await detectBottleneck({
      projectId: change.projectId,
      potentialChangeId: change.id,
      bottleneckType: 'notice_assessment_overdue',
      blockedByRole: 'commercial_manager',
      blockedByUserId: change.currentOwnerUserId,
      blockerReason: 'Notice assessment is past its due date',
      since: change.nextActionDueDate ?? today,
      valueAtRisk: change.estimatedValue ? Number(change.estimatedValue) : null,
    });
    detected += 1;
  }

  const requiredNotDrafted = await prisma.potentialChange.findMany({
    where: { noticeRequired: true, noticeStatus: 'required', noticeDueDate: { lt: today } },
    select: { id: true, projectId: true, estimatedValue: true, noticeDueDate: true },
  });

  for (const change of requiredNotDrafted) {
    await detectBottleneck({
      projectId: change.projectId,
      potentialChangeId: change.id,
      bottleneckType: 'notice_required_not_drafted',
      blockedByRole: 'contract_administrator',
      blockerReason: 'Notice is required and the contractual deadline has passed',
      since: change.noticeDueDate ?? today,
      valueAtRisk: change.estimatedValue ? Number(change.estimatedValue) : null,
    });
    detected += 1;
  }

  return { detected };
}
