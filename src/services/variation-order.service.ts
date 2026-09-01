import 'server-only';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { todayUtc } from '@/lib/dates';
import { formatVoNumber } from '@/lib/pc-number';
import { subtractDecimals } from '@/lib/money';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit } from '@/services/audit-log.service';
import { assertProjectAccess, scopeToUser } from '@/services/project-access.service';
import { loadRecipients, recordTaskNotifications } from '@/services/notification.service';

/**
 * The variation order: what we put to the client, and what they said back.
 *
 * ── Where it starts ────────────────────────────────────────────────────────
 * A VO is raised only from a change that reached `variation_approved` — two
 * seats have agreed the figure internally. Raising one earlier would put a
 * price to a client that nobody inside the company has stood behind, which is
 * the failure this product exists to prevent, arriving from the other side.
 *
 * ── One VO per change ──────────────────────────────────────────────────────
 * Osman's decision, 2026-09-01. A unique index enforces it. The consequence he
 * chose it for: a rejected VO drags nothing else down, and a partial approval
 * never has to be apportioned back across bundled changes by someone guessing.
 *
 * ── Submitted at, then answered ────────────────────────────────────────────
 * `submittedValue` is copied from the frozen pricing figure ONCE. The client's
 * answer is recorded as a SEPARATE `approvedValue`, so a lower agreed figure
 * leaves a visible shortfall instead of quietly overwriting what we asked for.
 * A company that cannot say what it conceded cannot learn to concede less.
 *
 * ── This service never sends anything ──────────────────────────────────────
 * It records that a submission was made, on a date, by a person. Delivery is
 * lane D's job and its result is lane D's report. Same rule as the notice.
 */

export const voSubmissionSchema = z.object({
  variationOrderId: z.string().uuid(),
  submittedOn: z.coerce.date(),
  timeImpactDaysClaimed: z.coerce.number().int().min(0).max(999).optional().nullable(),
  clientReference: z.string().trim().max(200).optional().nullable(),
});

export type VoSubmissionInput = z.infer<typeof voSubmissionSchema>;

export const clientResponseSchema = z
  .object({
    variationOrderId: z.string().uuid(),
    response: z.enum([
      'approved',
      'approved_with_adjustment',
      'rejected',
      'more_information_requested',
    ]),
    respondedOn: z.coerce.date(),
    approvedValue: z.string().trim().optional().nullable(),
    approvedTimeImpactDays: z.coerce.number().int().min(0).max(999).optional().nullable(),
    clientReference: z.string().trim().max(200).optional().nullable(),
    notes: z.string().trim().max(4000).optional().nullable(),
  })
  // An adjustment with no figure is not an adjustment anyone can invoice
  // against, and it would leave the VO approved for an unknown amount.
  .refine(
    (value) => value.response !== 'approved_with_adjustment' || Boolean(value.approvedValue),
    {
      message: 'Give the figure the client agreed. Without it there is nothing to invoice.',
      path: ['approvedValue'],
    },
  )
  // A rejection the client did not explain is a rejection nobody can answer.
  .refine((value) => value.response !== 'rejected' || (value.notes?.length ?? 0) >= 3, {
    message: 'Record what the client said. Someone has to act on it.',
    path: ['notes'],
  });

export type ClientResponseInput = z.infer<typeof clientResponseSchema>;

/* ─── Raising ────────────────────────────────────────────────────────────── */

/**
 * Creates the VO for an approved change. Idempotent: the unique index on
 * `potential_change_id` means a double click produces one VO, not two.
 */
export async function raiseVariationOrder(user: AuthenticatedUser, potentialChangeId: string) {
  const change = await prisma.potentialChange.findUnique({
    where: { id: potentialChangeId },
    include: { project: { select: { projectCode: true } } },
  });
  if (!change) throw new NotFoundError('Potential Change not found');

  await assertProjectAccess(user, change.projectId, 'variationOrder.manage');

  if (change.currentStatus !== 'variation_approved') {
    throw new ValidationError(
      'Only a change both seats have approved can go to the client as a variation order.',
    );
  }

  const existing = await prisma.variationOrder.findUnique({
    where: { potentialChangeId },
    select: { id: true, voNumber: true },
  });
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    const [bumped] = await tx.$queryRaw<{ vo_sequence: number }[]>`
      UPDATE projects SET vo_sequence = vo_sequence + 1
      WHERE id = ${change.projectId}::uuid
      RETURNING vo_sequence
    `;
    if (!bumped) throw new NotFoundError('Project not found');

    const voNumber = formatVoNumber(change.project.projectCode, bumped.vo_sequence);

    const vo = await tx.variationOrder.create({
      data: {
        projectId: change.projectId,
        potentialChangeId,
        voNumber,
        status: 'draft',
        title: change.title,
        description: change.description,
        // Copied once, from the figure the two seats approved. Never recomputed
        // from the line items, which anybody may still edit.
        submittedValue: change.submittedValue,
        timeImpactDaysClaimed: change.timeImpactDays,
      },
      select: { id: true, voNumber: true },
    });

    await recordAudit({
      db: tx,
      projectId: change.projectId,
      userId: user.id,
      recordType: 'variation_order',
      recordId: vo.id,
      actionType: 'created',
      newValue: { voNumber, submittedValue: change.submittedValue?.toString() ?? null },
    });

    return vo;
  });
}

/* ─── Submitting ─────────────────────────────────────────────────────────── */

export async function recordSubmission(user: AuthenticatedUser, input: VoSubmissionInput) {
  const parsed = voSubmissionSchema.parse(input);

  const vo = await prisma.variationOrder.findUnique({ where: { id: parsed.variationOrderId } });
  if (!vo) throw new NotFoundError('Variation order not found');

  await assertProjectAccess(user, vo.projectId, 'variationOrder.manage');

  if (vo.status !== 'draft') {
    throw new ValidationError('That variation order has already been submitted.');
  }
  if (!vo.submittedValue) {
    throw new ValidationError(
      'This variation order has no value. Price the change before putting it to the client.',
    );
  }
  assertNotFuture(parsed.submittedOn, 'A submission cannot be dated in the future.');

  return prisma.$transaction(async (tx) => {
    const updated = await tx.variationOrder.update({
      where: { id: parsed.variationOrderId },
      data: {
        status: 'submitted',
        submittedAt: parsed.submittedOn,
        submittedByUserId: user.id,
        clientResponse: 'awaiting',
        timeImpactDaysClaimed: parsed.timeImpactDaysClaimed ?? vo.timeImpactDaysClaimed,
        clientReference: parsed.clientReference || vo.clientReference,
      },
    });

    await recordAudit({
      db: tx,
      projectId: vo.projectId,
      userId: user.id,
      recordType: 'variation_order',
      recordId: vo.id,
      actionType: 'submitted',
      newValue: {
        voNumber: vo.voNumber,
        submittedValue: vo.submittedValue?.toString() ?? null,
        submittedOn: parsed.submittedOn.toISOString().slice(0, 10),
      },
    });

    return updated;
  });
}

/* ─── The client answers ─────────────────────────────────────────────────── */

export async function recordClientResponse(user: AuthenticatedUser, input: ClientResponseInput) {
  const parsed = clientResponseSchema.parse(input);

  const vo = await prisma.variationOrder.findUnique({
    where: { id: parsed.variationOrderId },
    include: { potentialChange: { select: { id: true, pcNumber: true, title: true } } },
  });
  if (!vo) throw new NotFoundError('Variation order not found');

  await assertProjectAccess(user, vo.projectId, 'variationOrder.manage');

  if (vo.status === 'draft') {
    throw new ValidationError('That variation order has not been put to the client yet.');
  }
  if (vo.status === 'withdrawn') {
    throw new ValidationError('That variation order was withdrawn.');
  }
  assertNotFuture(parsed.respondedOn, 'A client response cannot be dated in the future.');

  const submitted = vo.submittedValue?.toString() ?? '0';

  let approvedValue: string | null = null;
  let status: 'approved' | 'part_approved' | 'rejected' | 'submitted' = 'submitted';

  if (parsed.response === 'approved') {
    // Agreed in full means agreed at the figure we asked for. Taking a number
    // from the form here would let "approved" quietly mean something else.
    approvedValue = submitted;
    status = 'approved';
  } else if (parsed.response === 'approved_with_adjustment') {
    approvedValue = parsed.approvedValue!;
    const shortfall = subtractDecimals(submitted, approvedValue);
    if (shortfall.startsWith('-')) {
      throw new ValidationError(
        'The client agreed MORE than was submitted. Check the figure, or resubmit the ' +
          'variation at the higher value so the paper trail matches.',
      );
    }
    status = 'part_approved';
  } else if (parsed.response === 'rejected') {
    status = 'rejected';
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.variationOrder.update({
      where: { id: parsed.variationOrderId },
      data: {
        status,
        clientResponse: parsed.response,
        clientResponseAt: parsed.respondedOn,
        approvedValue: approvedValue ? new Prisma.Decimal(approvedValue) : null,
        approvedTimeImpactDays: parsed.approvedTimeImpactDays ?? null,
        clientReference: parsed.clientReference || vo.clientReference,
        clientResponseNotes: parsed.notes ?? null,
        recordedByUserId: user.id,
      },
    });

    await recordAudit({
      db: tx,
      projectId: vo.projectId,
      userId: user.id,
      recordType: 'variation_order',
      recordId: vo.id,
      actionType: parsed.response === 'rejected' ? 'rejected' : 'approved',
      oldValue: { status: vo.status, clientResponse: vo.clientResponse },
      newValue: {
        status,
        clientResponse: parsed.response,
        submittedValue: submitted,
        approvedValue,
        shortfall: approvedValue ? subtractDecimals(submitted, approvedValue) : null,
        clientReference: parsed.clientReference ?? null,
      },
    });

    // Somebody has to invoice it, and "the client agreed it" is exactly the
    // moment that gets forgotten, because the commercial team has moved on.
    if (status === 'approved' || status === 'part_approved') {
      const owner = await tx.projectMember.findFirst({
        where: { projectId: vo.projectId, active: true, projectRole: 'finance_officer' },
        select: { userId: true },
      });

      const due = new Date(todayUtc());
      due.setUTCDate(due.getUTCDate() + 7);

      const task = await tx.task.create({
        data: {
          projectId: vo.projectId,
          potentialChangeId: vo.potentialChangeId,
          taskType: 'other',
          title: `Invoice ${vo.voNumber}`,
          description: `${vo.title}. The client agreed ${approvedValue}. Apply for it.`,
          assignedToUserId: owner?.userId ?? null,
          assignedByUserId: user.id,
          dueDate: due,
          priority: 'high',
        },
      });

      if (owner?.userId) {
        const recipients = await loadRecipients([owner.userId]);
        await recordTaskNotifications(tx, {
          taskId: task.id,
          potentialChangeId: vo.potentialChangeId,
          kind: 'task_assigned',
          subject: `${vo.voNumber} agreed — invoice it`,
          body: `${vo.title}. The client agreed ${approvedValue}.`,
          on: todayUtc(),
          recipients,
        });
      }
    }

    return updated;
  });
}

export const withdrawSchema = z.object({
  variationOrderId: z.string().uuid(),
  reason: z.string().trim().min(3, 'Say why it is being withdrawn').max(2000),
});

export async function withdrawVariationOrder(
  user: AuthenticatedUser,
  input: z.infer<typeof withdrawSchema>,
) {
  const parsed = withdrawSchema.parse(input);

  const vo = await prisma.variationOrder.findUnique({
    where: { id: parsed.variationOrderId },
    include: { _count: { select: { invoices: true } } },
  });
  if (!vo) throw new NotFoundError('Variation order not found');

  await assertProjectAccess(user, vo.projectId, 'variationOrder.manage');

  if (vo._count.invoices > 0) {
    // Withdrawing something already applied for would orphan real money.
    throw new ValidationError(
      'This variation has been invoiced. Cancel the applications first, or raise a credit.',
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.variationOrder.update({
      where: { id: parsed.variationOrderId },
      data: { status: 'withdrawn', clientResponseNotes: parsed.reason },
    });

    await recordAudit({
      db: tx,
      projectId: vo.projectId,
      userId: user.id,
      recordType: 'variation_order',
      recordId: vo.id,
      actionType: 'updated',
      oldValue: { status: vo.status },
      newValue: { status: 'withdrawn', reason: parsed.reason },
    });

    return updated;
  });
}

/* ─── Reading ────────────────────────────────────────────────────────────── */

export async function getVariationOrderForChange(potentialChangeId: string) {
  return prisma.variationOrder.findUnique({
    where: { potentialChangeId },
    include: {
      submittedBy: { select: { fullName: true } },
      recordedBy: { select: { fullName: true } },
      invoices: {
        orderBy: { periodEnd: 'asc' },
        include: { payments: { orderBy: { receivedAt: 'asc' } } },
      },
    },
  });
}

export async function listVariationOrders(
  user: AuthenticatedUser,
  filters: { projectId?: string } = {},
) {
  const scope = await scopeToUser(user);
  const where: Prisma.VariationOrderWhereInput = { ...scope };

  if (filters.projectId) {
    await assertProjectAccess(user, filters.projectId);
    where.projectId = filters.projectId;
  }

  return prisma.variationOrder.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }],
    include: {
      project: { select: { id: true, projectCode: true, currency: true } },
      potentialChange: { select: { id: true, pcNumber: true } },
      invoices: { select: { status: true, grossThisPeriod: true, totalDue: true } },
    },
  });
}

function assertNotFuture(date: Date, message: string) {
  const endOfToday = new Date(todayUtc());
  endOfToday.setUTCDate(endOfToday.getUTCDate() + 1);
  if (date.getTime() >= endOfToday.getTime()) throw new ValidationError(message);
}
