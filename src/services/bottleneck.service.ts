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
      currentStatus: { notIn: ['cancelled', 'included_scope', 'variation_approved'] },
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

  // Approved, issued, and still sitting in the outbox. Either the courier lane
  // is not wired or the send keeps failing. Either way nobody has been told,
  // and the notice period is running.
  const draftedNotSent = await prisma.notice.findMany({
    where: { status: 'issued', issuedAt: { lt: today } },
    select: {
      id: true, projectId: true, potentialChangeId: true, issuedAt: true,
      potentialChange: { select: { estimatedValue: true } },
    },
  });

  for (const notice of draftedNotSent) {
    await detectBottleneck({
      projectId: notice.projectId,
      potentialChangeId: notice.potentialChangeId,
      bottleneckType: 'notice_drafted_not_sent',
      blockedByRole: 'contract_administrator',
      blockerReason: 'The notice was approved but has not left the building',
      since: notice.issuedAt ?? today,
      valueAtRisk: notice.potentialChange.estimatedValue
        ? Number(notice.potentialChange.estimatedValue)
        : null,
    });
    detected += 1;
  }

  // Marked sent with nothing to point at. A notice you cannot prove you served
  // is, in an argument, a notice you did not serve — so this is raised even
  // though the app's own state says the job is done.
  const sentWithoutProof = await prisma.notice.findMany({
    where: {
      status: { in: ['sent', 'acknowledged'] },
      OR: [{ externalMessageId: null }, { documentId: null }],
    },
    select: {
      id: true, projectId: true, potentialChangeId: true, sentAt: true,
      externalMessageId: true, documentId: true,
      potentialChange: { select: { estimatedValue: true } },
    },
  });

  for (const notice of sentWithoutProof) {
    await detectBottleneck({
      projectId: notice.projectId,
      potentialChangeId: notice.potentialChangeId,
      bottleneckType: 'notice_sent_no_proof',
      blockedByRole: 'contract_administrator',
      blockerReason: notice.externalMessageId
        ? 'The notice was served but no copy is filed in the project folder'
        : 'The notice was served but the courier returned no message id',
      since: notice.sentAt ?? today,
      valueAtRisk: notice.potentialChange.estimatedValue
        ? Number(notice.potentialChange.estimatedValue)
        : null,
    });
    detected += 1;
  }

  // ── The money end ────────────────────────────────────────────────────────
  // Three quiet stages. Each has no owner by default, because whoever did the
  // last step has moved on and whoever should do the next one does not yet
  // know it is theirs. That gap is where agreed money goes to die.

  const rules = await prisma.projectContractRule.findMany({
    select: { projectId: true, voResponseDays: true },
  });
  const responseDays = new Map(rules.map((rule) => [rule.projectId, rule.voResponseDays]));

  // Approved internally and never put to the client.
  const notSubmitted = await prisma.variationOrder.findMany({
    where: { status: 'draft' },
    select: { id: true, projectId: true, potentialChangeId: true, submittedValue: true, createdAt: true },
  });

  for (const vo of notSubmitted) {
    // A VO raised today is not a bottleneck. Seven days is the grace: long
    // enough to assemble the submission, short enough that it is still fresh.
    const age = daysSince(vo.createdAt) ?? 0;
    if (age < 7) continue;

    await detectBottleneck({
      projectId: vo.projectId,
      potentialChangeId: vo.potentialChangeId,
      bottleneckType: 'vo_not_submitted',
      blockedByRole: 'quantity_surveyor',
      blockerReason: 'Approved internally and not yet put to the client',
      since: vo.createdAt,
      valueAtRisk: vo.submittedValue ? Number(vo.submittedValue) : null,
    });
    detected += 1;
  }

  // Submitted and the client has said nothing, past the response period.
  const awaiting = await prisma.variationOrder.findMany({
    where: { status: 'submitted', clientResponse: 'awaiting', submittedAt: { not: null } },
    select: { id: true, projectId: true, potentialChangeId: true, submittedValue: true, submittedAt: true },
  });

  for (const vo of awaiting) {
    const waited = daysSince(vo.submittedAt!) ?? 0;
    if (waited < (responseDays.get(vo.projectId) ?? 14)) continue;

    await detectBottleneck({
      projectId: vo.projectId,
      potentialChangeId: vo.potentialChangeId,
      bottleneckType: 'client_approval_overdue',
      blockedByRole: 'client',
      blockerReason: `The client has not answered in ${waited} days`,
      since: vo.submittedAt!,
      valueAtRisk: vo.submittedValue ? Number(vo.submittedValue) : null,
    });
    detected += 1;
  }

  // Agreed by the client and not fully applied for. The headline failure: the
  // company has done the work, won the argument, and not asked for the money.
  const agreed = await prisma.variationOrder.findMany({
    where: { status: { in: ['approved', 'part_approved'] }, clientResponseAt: { not: null } },
    select: {
      id: true, projectId: true, potentialChangeId: true,
      approvedValue: true, clientResponseAt: true,
      invoices: { select: { status: true, grossThisPeriod: true } },
    },
  });

  for (const vo of agreed) {
    const applied = vo.invoices
      .filter((invoice) => invoice.status !== 'cancelled')
      .reduce((total, invoice) => total + Number(invoice.grossThisPeriod), 0);
    const approvedValue = Number(vo.approvedValue ?? 0);
    const unbilled = approvedValue - applied;

    // A fils of rounding is not an unbilled variation.
    if (unbilled <= 0.01) continue;

    const waited = daysSince(vo.clientResponseAt!) ?? 0;
    if (waited < 14) continue;

    await detectBottleneck({
      projectId: vo.projectId,
      potentialChangeId: vo.potentialChangeId,
      bottleneckType: 'approved_not_invoiced',
      blockedByRole: 'finance_officer',
      blockerReason: `Agreed ${waited} days ago and ${unbilled.toFixed(2)} has not been applied for`,
      since: vo.clientResponseAt!,
      valueAtRisk: unbilled,
    });
    detected += 1;
  }

  // Issued, past its terms, unpaid.
  const overdueInvoices = await prisma.invoice.findMany({
    where: { status: { in: ['issued', 'part_paid'] }, dueAt: { lt: today } },
    select: {
      id: true, projectId: true, dueAt: true, totalDue: true, invoiceNumber: true,
      variationOrder: { select: { potentialChangeId: true } },
      payments: { select: { amount: true } },
    },
  });

  for (const invoice of overdueInvoices) {
    const received = invoice.payments.reduce((total, p) => total + Number(p.amount), 0);
    const outstanding = Number(invoice.totalDue) - received;
    if (outstanding <= 0.01) continue;

    await detectBottleneck({
      projectId: invoice.projectId,
      potentialChangeId: invoice.variationOrder.potentialChangeId,
      bottleneckType: 'invoice_overdue',
      blockedByRole: 'client',
      blockerReason: `${invoice.invoiceNumber} is past its payment terms with ${outstanding.toFixed(2)} outstanding`,
      since: invoice.dueAt ?? today,
      valueAtRisk: outstanding,
    });
    detected += 1;
  }

  return { detected };
}
