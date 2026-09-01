import 'server-only';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { todayUtc } from '@/lib/dates';
import { formatInvoiceNumber } from '@/lib/pc-number';
import { calculateApplication, subtractDecimals, sumDecimals } from '@/lib/money';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit } from '@/services/audit-log.service';
import { assertProjectAccess, scopeToUser } from '@/services/project-access.service';

/**
 * Progress applications against an agreed variation.
 *
 * Osman's decision, 2026-09-01: fit-out is billed monthly against a percentage
 * of the agreed value with retention held back, not as one invoice per VO. So
 * every row here is an APPLICATION, and several of them add up to the VO.
 *
 * ── A person enters ONE number ─────────────────────────────────────────────
 * "We are 75% complete at the end of September." That is what a valuation
 * states and it is the only figure typed in. Everything else — what was
 * applied for before, this period's gross, retention, VAT, the total — is
 * computed by `lib/money.ts` and frozen onto the row. Asking a person to type
 * the total means the day they mistype it, the system agrees with them.
 *
 * ── Frozen, including the history ──────────────────────────────────────────
 * `basisValue` and `previouslyApplied` are stored on each application, not
 * recomputed. So if the client later revises the VO, or an earlier application
 * is cancelled, the arithmetic on an issued invoice can still be reproduced
 * line for line — because that is the paper the client is holding.
 *
 * ── Nothing derived is stored ──────────────────────────────────────────────
 * "Overdue", "approved but unbilled", "retention held" are computed on read.
 * A stored total needs a job to maintain it, and the day that job fails the
 * number is both wrong and confident.
 */

export const applicationSchema = z.object({
  variationOrderId: z.string().uuid(),
  periodEnd: z.coerce.date(),
  cumulativePercent: z.coerce.number().min(0).max(100),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export type ApplicationInput = z.infer<typeof applicationSchema>;

/**
 * Drafts the next application. Nothing is owed until it is issued.
 */
export async function draftApplication(user: AuthenticatedUser, input: ApplicationInput) {
  const parsed = applicationSchema.parse(input);

  const vo = await prisma.variationOrder.findUnique({
    where: { id: parsed.variationOrderId },
    include: {
      project: {
        select: { id: true, projectCode: true, contractRules: true },
      },
      invoices: { select: { id: true, status: true, grossThisPeriod: true, cumulativePercent: true } },
    },
  });
  if (!vo) throw new NotFoundError('Variation order not found');

  await assertProjectAccess(user, vo.projectId, 'invoice.manage');

  if (vo.status !== 'approved' && vo.status !== 'part_approved') {
    throw new ValidationError(
      'Only a variation the client has agreed can be applied for. ' +
        'Record their response first.',
    );
  }

  const basisValue = vo.approvedValue?.toString();
  if (!basisValue) {
    throw new ValidationError('This variation has no agreed value to apply against.');
  }

  // Cancelled applications are excluded from the running total: the money was
  // never certified, so leaving it in would suppress every later application
  // by that amount, silently.
  const live = vo.invoices.filter((invoice) => invoice.status !== 'cancelled');
  const previouslyApplied = sumDecimals(live.map((invoice) => invoice.grossThisPeriod.toString()));

  const highestPercent = live.reduce(
    (max, invoice) => Math.max(max, Number(invoice.cumulativePercent)),
    0,
  );
  if (parsed.cumulativePercent < highestPercent) {
    throw new ValidationError(
      `A previous application already certified ${highestPercent}%. ` +
        'Completion cannot go backwards on an application.',
    );
  }

  const company = await prisma.companySettings.findFirst({ where: { singleton: true } });
  const retentionPercent = vo.project.contractRules?.retentionPercent?.toString() ?? '5';
  const vatPercent = company?.vatPercent?.toString() ?? '5';

  const lines = calculateApplication({
    basisValue,
    cumulativePercent: parsed.cumulativePercent.toString(),
    previouslyApplied,
    retentionPercent,
    vatPercent,
  });

  return prisma.$transaction(async (tx) => {
    const [bumped] = await tx.$queryRaw<{ invoice_sequence: number }[]>`
      UPDATE projects SET invoice_sequence = invoice_sequence + 1
      WHERE id = ${vo.projectId}::uuid
      RETURNING invoice_sequence
    `;
    if (!bumped) throw new NotFoundError('Project not found');

    const invoiceNumber = formatInvoiceNumber(vo.project.projectCode, bumped.invoice_sequence);

    const invoice = await tx.invoice.create({
      data: {
        projectId: vo.projectId,
        variationOrderId: vo.id,
        invoiceNumber,
        status: 'draft',
        periodEnd: parsed.periodEnd,
        cumulativePercent: new Prisma.Decimal(parsed.cumulativePercent),
        basisValue: new Prisma.Decimal(basisValue),
        previouslyApplied: new Prisma.Decimal(previouslyApplied),
        grossThisPeriod: new Prisma.Decimal(lines.grossThisPeriod),
        retentionPercent: new Prisma.Decimal(retentionPercent),
        retentionAmount: new Prisma.Decimal(lines.retentionAmount),
        netValue: new Prisma.Decimal(lines.netValue),
        vatPercent: new Prisma.Decimal(vatPercent),
        vatAmount: new Prisma.Decimal(lines.vatAmount),
        totalDue: new Prisma.Decimal(lines.totalDue),
        notes: parsed.notes ?? null,
      },
    });

    await recordAudit({
      db: tx,
      projectId: vo.projectId,
      userId: user.id,
      recordType: 'invoice',
      recordId: invoice.id,
      actionType: 'created',
      newValue: { invoiceNumber, voNumber: vo.voNumber, ...lines },
    });

    return invoice;
  });
}

export const issueInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  issuedOn: z.coerce.date(),
  clientReference: z.string().trim().max(200).optional().nullable(),
});

/**
 * Issues it. The figures stop being editable and the clock starts.
 *
 * `dueAt` is frozen from the payment terms as they stand today, not read back
 * from the contract rules later — this invoice fell due when it fell due, and
 * a term changed next year must not silently make an old invoice late or
 * early.
 */
export async function issueInvoice(
  user: AuthenticatedUser,
  input: z.infer<typeof issueInvoiceSchema>,
) {
  const parsed = issueInvoiceSchema.parse(input);

  const invoice = await prisma.invoice.findUnique({
    where: { id: parsed.invoiceId },
    include: { project: { select: { contractRules: true } } },
  });
  if (!invoice) throw new NotFoundError('Invoice not found');

  await assertProjectAccess(user, invoice.projectId, 'invoice.manage');

  if (invoice.status !== 'draft') {
    throw new ValidationError('That application has already been issued.');
  }
  const endOfToday = new Date(todayUtc());
  endOfToday.setUTCDate(endOfToday.getUTCDate() + 1);
  if (parsed.issuedOn.getTime() >= endOfToday.getTime()) {
    throw new ValidationError('An invoice cannot be dated in the future.');
  }

  const termsDays = invoice.project.contractRules?.paymentTermsDays ?? 30;
  const dueAt = new Date(parsed.issuedOn);
  dueAt.setUTCDate(dueAt.getUTCDate() + termsDays);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.invoice.update({
      where: { id: parsed.invoiceId },
      data: {
        status: 'issued',
        issuedAt: parsed.issuedOn,
        issuedByUserId: user.id,
        dueAt,
        clientReference: parsed.clientReference || invoice.clientReference,
      },
    });

    await recordAudit({
      db: tx,
      projectId: invoice.projectId,
      userId: user.id,
      recordType: 'invoice',
      recordId: invoice.id,
      actionType: 'issued',
      newValue: {
        invoiceNumber: invoice.invoiceNumber,
        totalDue: invoice.totalDue.toString(),
        dueAt: dueAt.toISOString().slice(0, 10),
        paymentTermsDays: termsDays,
      },
    });

    return updated;
  });
}

export const cancelInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  reason: z.string().trim().min(3, 'Say why it is being cancelled').max(2000),
});

/**
 * Cancels an application. Never deletes it.
 *
 * An issued invoice with payments against it cannot be cancelled: the money
 * arrived, and making the document it arrived against disappear would leave
 * cash on a project with nothing to attach it to.
 */
export async function cancelInvoice(
  user: AuthenticatedUser,
  input: z.infer<typeof cancelInvoiceSchema>,
) {
  const parsed = cancelInvoiceSchema.parse(input);

  const invoice = await prisma.invoice.findUnique({
    where: { id: parsed.invoiceId },
    include: { _count: { select: { payments: true } } },
  });
  if (!invoice) throw new NotFoundError('Invoice not found');

  await assertProjectAccess(user, invoice.projectId, 'invoice.manage');

  if (invoice._count.payments > 0) {
    throw new ValidationError(
      'Money has been received against this application. Raise a credit rather than cancelling it.',
    );
  }
  if (invoice.status === 'cancelled') return invoice;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.invoice.update({
      where: { id: parsed.invoiceId },
      data: { status: 'cancelled', cancelledAt: new Date(), cancelledReason: parsed.reason },
    });

    await recordAudit({
      db: tx,
      projectId: invoice.projectId,
      userId: user.id,
      recordType: 'invoice',
      recordId: invoice.id,
      actionType: 'updated',
      oldValue: { status: invoice.status },
      newValue: { status: 'cancelled', reason: parsed.reason },
    });

    return updated;
  });
}

/* ─── The number that justifies the product ──────────────────────────────── */

export interface CommercialPosition {
  /** Agreed by the client, across every live VO. */
  approvedValue: string;
  /** Gross applied for, across every live application. */
  appliedValue: string;
  /** Agreed and not yet applied for. The headline. */
  unbilledValue: string;
  /** Held back from applications until practical completion. */
  retentionHeld: string;
  /** Invoiced, net of retention, plus VAT. What the client was asked for. */
  invoicedTotal: string;
  /** Received. */
  paidTotal: string;
  /** Asked for and not received. */
  outstandingTotal: string;
  /** Outstanding and past its due date. */
  overdueTotal: string;
  /** Submitted less agreed, across part-approved VOs. What was conceded. */
  shortfallValue: string;
  overdueCount: number;
  unbilledCount: number;
}

/**
 * "Approved but unbilled", and everything around it.
 *
 * Computed from rows on every read, deliberately. This is the figure a
 * director acts on, and a cached one that quietly stopped updating is worse
 * than no figure at all — they would still act on it.
 */
export async function getCommercialPosition(
  user: AuthenticatedUser,
  filters: { projectId?: string } = {},
): Promise<CommercialPosition> {
  const scope = await scopeToUser(user);
  const where: Prisma.VariationOrderWhereInput = {
    ...scope,
    status: { in: ['approved', 'part_approved'] },
  };

  if (filters.projectId) {
    await assertProjectAccess(user, filters.projectId);
    where.projectId = filters.projectId;
  }

  const orders = await prisma.variationOrder.findMany({
    where,
    select: {
      id: true,
      submittedValue: true,
      approvedValue: true,
      invoices: {
        select: {
          status: true,
          grossThisPeriod: true,
          retentionAmount: true,
          totalDue: true,
          dueAt: true,
          payments: { select: { amount: true } },
        },
      },
    },
  });

  const today = todayUtc();

  let approved = '0.00';
  let applied = '0.00';
  let retention = '0.00';
  let invoiced = '0.00';
  let paid = '0.00';
  let overdue = '0.00';
  let shortfall = '0.00';
  let overdueCount = 0;
  let unbilledCount = 0;

  for (const order of orders) {
    const orderApproved = order.approvedValue?.toString() ?? '0.00';
    approved = sumDecimals([approved, orderApproved]);

    if (order.submittedValue) {
      const gap = subtractDecimals(order.submittedValue.toString(), orderApproved);
      if (!gap.startsWith('-')) shortfall = sumDecimals([shortfall, gap]);
    }

    let orderApplied = '0.00';

    for (const invoice of order.invoices) {
      if (invoice.status === 'cancelled') continue;

      orderApplied = sumDecimals([orderApplied, invoice.grossThisPeriod.toString()]);
      retention = sumDecimals([retention, invoice.retentionAmount.toString()]);

      if (invoice.status === 'draft') continue;

      invoiced = sumDecimals([invoiced, invoice.totalDue.toString()]);
      const received = sumDecimals(invoice.payments.map((payment) => payment.amount.toString()));
      paid = sumDecimals([paid, received]);

      const unpaid = subtractDecimals(invoice.totalDue.toString(), received);
      const isOutstanding = !unpaid.startsWith('-') && unpaid !== '0.00';
      if (isOutstanding && invoice.dueAt && invoice.dueAt.getTime() < today.getTime()) {
        overdue = sumDecimals([overdue, unpaid]);
        overdueCount += 1;
      }
    }

    applied = sumDecimals([applied, orderApplied]);

    const remaining = subtractDecimals(orderApproved, orderApplied);
    if (!remaining.startsWith('-') && remaining !== '0.00') unbilledCount += 1;
  }

  const unbilled = subtractDecimals(approved, applied);

  return {
    approvedValue: approved,
    appliedValue: applied,
    unbilledValue: unbilled.startsWith('-') ? '0.00' : unbilled,
    retentionHeld: retention,
    invoicedTotal: invoiced,
    paidTotal: paid,
    outstandingTotal: subtractDecimals(invoiced, paid),
    overdueTotal: overdue,
    shortfallValue: shortfall,
    overdueCount,
    unbilledCount,
  };
}

export async function listInvoices(
  user: AuthenticatedUser,
  filters: { projectId?: string } = {},
) {
  const scope = await scopeToUser(user);
  const where: Prisma.InvoiceWhereInput = { ...scope };

  if (filters.projectId) {
    await assertProjectAccess(user, filters.projectId);
    where.projectId = filters.projectId;
  }

  return prisma.invoice.findMany({
    where,
    orderBy: [{ periodEnd: 'desc' }],
    include: {
      project: { select: { id: true, projectCode: true, currency: true } },
      variationOrder: { select: { id: true, voNumber: true, title: true } },
      payments: { select: { amount: true } },
    },
  });
}
