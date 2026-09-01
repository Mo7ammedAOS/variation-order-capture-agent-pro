import 'server-only';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { todayUtc } from '@/lib/dates';
import { subtractDecimals, sumDecimals, toFils } from '@/lib/money';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit } from '@/services/audit-log.service';
import { assertProjectAccess, scopeToUser } from '@/services/project-access.service';
import { issuedCredits } from '@/services/credit-note.service';

/**
 * Money actually received.
 *
 * ── Many payments to one invoice ───────────────────────────────────────────
 * Part payment is ordinary, not an exception. A one-payment-per-invoice model
 * forces whoever is doing the books to round, or to invent a second invoice
 * that was never issued, and both of those end up in front of an auditor.
 *
 * ── The invoice status follows the money, and is never typed ───────────────
 * `issued`, `part_paid` and `paid` are set from the sum of the payments on the
 * row, every time one is added or removed. Letting someone tick "paid" by hand
 * would let the register say paid while the bank says otherwise, and the
 * register is what the director reads.
 *
 * ── Overpayment is refused, not absorbed ───────────────────────────────────
 * Receiving more than was invoiced means the payment belongs somewhere else,
 * or the invoice was wrong. Silently accepting it would hide both.
 */

export const paymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.string().trim().min(1, 'Enter the amount received'),
  receivedOn: z.coerce.date(),
  reference: z.string().trim().max(200).optional().nullable(),
  method: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export type PaymentInput = z.infer<typeof paymentSchema>;

export async function recordPayment(user: AuthenticatedUser, input: PaymentInput) {
  const parsed = paymentSchema.parse(input);

  const invoice = await prisma.invoice.findUnique({
    where: { id: parsed.invoiceId },
    include: {
      payments: { select: { amount: true } },
      creditNotes: { select: { status: true, totalCredited: true } },
    },
  });
  if (!invoice) throw new NotFoundError('Invoice not found');

  await assertProjectAccess(user, invoice.projectId, 'payment.record');

  if (invoice.status === 'draft') {
    throw new ValidationError(
      'That application has not been issued yet, so nothing can have been paid against it.',
    );
  }
  if (invoice.status === 'cancelled') {
    throw new ValidationError('That application was cancelled.');
  }

  const amountFils = toFils(parsed.amount);
  if (amountFils <= 0) throw new ValidationError('A payment must be more than zero');

  const endOfToday = new Date(todayUtc());
  endOfToday.setUTCDate(endOfToday.getUTCDate() + 1);
  if (parsed.receivedOn.getTime() >= endOfToday.getTime()) {
    throw new ValidationError('A payment cannot be dated in the future.');
  }

  const alreadyPaid = sumDecimals(invoice.payments.map((payment) => payment.amount.toString()));
  // What the client actually owes, which is the invoice less anything credited
  // back. Without this a fully credited invoice would still accept a payment
  // for its original face value, and the money would sit against a demand that
  // no longer exists.
  const credited = sumDecimals(
    issuedCredits(invoice.creditNotes).map((note) => note.totalCredited.toString()),
  );
  const demand = subtractDecimals(invoice.totalDue.toString(), credited);
  const outstanding = subtractDecimals(demand, alreadyPaid);

  if (amountFils > toFils(outstanding)) {
    throw new ValidationError(
      toFils(credited) > 0
        ? `Only ${outstanding} is outstanding on this application after credits of ${credited}. ` +
          'A larger receipt belongs to another invoice.'
        : `Only ${outstanding} is outstanding on this application. ` +
          'A larger receipt belongs to another invoice, or this one was wrong.',
    );
  }

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        projectId: invoice.projectId,
        invoiceId: invoice.id,
        amount: new Prisma.Decimal(parsed.amount),
        receivedAt: parsed.receivedOn,
        reference: parsed.reference ?? null,
        method: parsed.method ?? null,
        notes: parsed.notes ?? null,
        recordedByUserId: user.id,
      },
    });

    const status = await refreshInvoiceStatus(tx, invoice.id);

    await recordAudit({
      db: tx,
      projectId: invoice.projectId,
      userId: user.id,
      recordType: 'payment',
      recordId: payment.id,
      actionType: 'created',
      newValue: {
        invoiceNumber: invoice.invoiceNumber,
        amount: parsed.amount,
        receivedOn: parsed.receivedOn.toISOString().slice(0, 10),
        reference: parsed.reference ?? null,
        invoiceStatus: status,
      },
    });

    return payment;
  });
}

/**
 * Removes a receipt that was entered against the wrong invoice.
 *
 * Deleting a payment row is the one deletion this system allows, and only
 * because the alternative — a negative payment — makes every sum on the page
 * mean something else. The audit event holds what was removed, so nothing is
 * actually lost.
 */
export async function removePayment(user: AuthenticatedUser, paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { invoice: { select: { id: true, invoiceNumber: true } } },
  });
  if (!payment) throw new NotFoundError('Payment not found');

  await assertProjectAccess(user, payment.projectId, 'payment.record');

  return prisma.$transaction(async (tx) => {
    await tx.payment.delete({ where: { id: paymentId } });
    const status = await refreshInvoiceStatus(tx, payment.invoiceId);

    await recordAudit({
      db: tx,
      projectId: payment.projectId,
      userId: user.id,
      recordType: 'payment',
      recordId: paymentId,
      actionType: 'deleted',
      oldValue: {
        invoiceNumber: payment.invoice.invoiceNumber,
        amount: payment.amount.toString(),
        receivedAt: payment.receivedAt.toISOString().slice(0, 10),
        reference: payment.reference,
      },
      newValue: { invoiceStatus: status },
    });

    return { removed: true };
  });
}

/**
 * Sets the invoice status from the sum of its payments. The single place that
 * decides whether something is paid.
 */
async function refreshInvoiceStatus(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<'issued' | 'part_paid' | 'paid'> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      payments: { select: { amount: true } },
      creditNotes: { select: { status: true, totalCredited: true } },
    },
  });
  if (!invoice) throw new NotFoundError('Invoice not found');

  const paid = toFils(sumDecimals(invoice.payments.map((payment) => payment.amount.toString())));
  const credited = toFils(
    sumDecimals(issuedCredits(invoice.creditNotes).map((note) => note.totalCredited.toString())),
  );
  // Settled against what is actually owed, not the face value. An invoice
  // half of which was credited is paid when the other half arrives.
  const due = toFils(invoice.totalDue.toString()) - credited;

  // Still driven by money received. An invoice nobody has paid stays `issued`
  // even when a credit has taken the whole of it away — calling that "paid"
  // would put a receipt in the ledger that never happened. What the credit
  // changes is the outstanding figure, which is computed on read.
  const status = paid <= 0 ? 'issued' : paid >= due ? 'paid' : 'part_paid';

  await tx.invoice.update({ where: { id: invoiceId }, data: { status } });
  return status;
}

export async function listPayments(
  user: AuthenticatedUser,
  filters: { projectId?: string } = {},
) {
  const scope = await scopeToUser(user);
  const where: Prisma.PaymentWhereInput = { ...scope };

  if (filters.projectId) {
    await assertProjectAccess(user, filters.projectId);
    where.projectId = filters.projectId;
  }

  return prisma.payment.findMany({
    where,
    orderBy: { receivedAt: 'desc' },
    include: {
      invoice: { select: { id: true, invoiceNumber: true, totalDue: true } },
      recordedBy: { select: { fullName: true } },
    },
  });
}
