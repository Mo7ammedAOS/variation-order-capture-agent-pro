import 'server-only';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { todayUtc } from '@/lib/dates';
import { formatCreditNoteNumber } from '@/lib/pc-number';
import { calculateCredit, subtractDecimals, sumDecimals, toFils } from '@/lib/money';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit } from '@/services/audit-log.service';
import { assertProjectAccess, scopeToUser } from '@/services/project-access.service';

/**
 * Putting a wrong figure right.
 *
 * ── Why this had to exist ──────────────────────────────────────────────────
 * Until now the system REFUSED every correction. An application that
 * over-certified could not be reduced, because completion may not go
 * backwards. An invoice with money against it could not be cancelled, because
 * the cash would have nothing to attach to. A receipt larger than the invoice
 * was rejected, because it must belong somewhere else. Each of those refusals
 * is right on its own, and together they meant a wrong number that had reached
 * the client could never be corrected at all — so the only remaining move was
 * to edit history, or to keep a spreadsheet on the side. Both of those end up
 * in front of an auditor.
 *
 * ── A document, not an edit ────────────────────────────────────────────────
 * The client is holding an invoice that says a number. That number has to stay
 * reproducible line for line, so nothing here touches the invoice's figures.
 * The credit is its own document, with its own number, its own date, its own
 * stated reason, and the name of whoever issued it.
 *
 * ── It gives the retention back too ────────────────────────────────────────
 * Crediting 10,000 of over-certification does not put 10,000 on the client's
 * account. 500 of it was withheld as retention and never billed. A credit that
 * returned the net and quietly kept the retention would leave the company
 * reporting money it is no longer entitled to hold — and that error compounds
 * with every correction. `calculateCredit` mirrors the application exactly.
 *
 * ── Draft, then issue ──────────────────────────────────────────────────────
 * A draft changes no figure anywhere. Only an ISSUED credit reduces what the
 * client owes, what has been applied for, and what retention is held. The gap
 * between the two is where somebody checks it.
 */

export const creditNoteSchema = z.object({
  invoiceId: z.string().uuid(),
  reason: z.enum(['over_certification', 'wrong_invoice', 'client_deduction', 'duplicate', 'other']),
  narrative: z
    .string()
    .trim()
    .min(10, 'Say why this is being credited. A credit with no explanation reads as a mistake.')
    .max(2000),
  /** The gross being taken back. Retention and VAT follow from it. */
  grossAmount: z.string().trim().min(1, 'Enter the amount being credited'),
});

export type CreditNoteInput = z.infer<typeof creditNoteSchema>;

/**
 * Drafts a credit against an issued invoice. Nothing moves until it is issued.
 */
export async function draftCreditNote(user: AuthenticatedUser, input: CreditNoteInput) {
  const parsed = creditNoteSchema.parse(input);

  const invoice = await prisma.invoice.findUnique({
    where: { id: parsed.invoiceId },
    include: {
      project: { select: { projectCode: true } },
      creditNotes: { select: { status: true, grossAmount: true } },
    },
  });
  if (!invoice) throw new NotFoundError('Invoice not found');

  await assertProjectAccess(user, invoice.projectId, 'invoice.manage');

  // A draft has not reached anybody. Cancelling it leaves no document behind
  // to be reconciled, and a credit against a document the client never saw
  // would be two pieces of paper explaining one non-event.
  if (invoice.status === 'draft') {
    throw new ValidationError(
      'That application has not been issued. Cancel it instead — there is nothing to credit.',
    );
  }
  if (invoice.status === 'cancelled') {
    throw new ValidationError('That application was cancelled, so there is nothing to credit.');
  }

  const available = creditableGross(invoice.grossThisPeriod.toString(), invoice.creditNotes);

  const requested = toFils(parsed.grossAmount);
  if (requested <= 0) throw new ValidationError('A credit must be more than zero');
  if (requested > toFils(available)) {
    throw new ValidationError(
      `Only ${available} of that application is left to credit. ` +
        'Crediting more than was invoiced would make the client a creditor of this project.',
    );
  }

  // The rates come off the INVOICE, never from today's contract rules. A
  // retention percentage renegotiated next year must not change what was
  // withheld last year.
  const lines = calculateCredit({
    grossAmount: parsed.grossAmount,
    retentionPercent: invoice.retentionPercent.toString(),
    vatPercent: invoice.vatPercent.toString(),
  });

  return prisma.$transaction(async (tx) => {
    const [bumped] = await tx.$queryRaw<{ credit_note_sequence: number }[]>`
      UPDATE projects SET credit_note_sequence = credit_note_sequence + 1
      WHERE id = ${invoice.projectId}::uuid
      RETURNING credit_note_sequence
    `;
    if (!bumped) throw new NotFoundError('Project not found');

    const creditNoteNumber = formatCreditNoteNumber(
      invoice.project.projectCode,
      bumped.credit_note_sequence,
    );

    const note = await tx.creditNote.create({
      data: {
        projectId: invoice.projectId,
        invoiceId: invoice.id,
        creditNoteNumber,
        status: 'draft',
        reason: parsed.reason,
        narrative: parsed.narrative,
        grossAmount: new Prisma.Decimal(lines.grossAmount),
        retentionAmount: new Prisma.Decimal(lines.retentionAmount),
        netValue: new Prisma.Decimal(lines.netValue),
        vatPercent: invoice.vatPercent,
        vatAmount: new Prisma.Decimal(lines.vatAmount),
        totalCredited: new Prisma.Decimal(lines.totalCredited),
      },
    });

    await recordAudit({
      db: tx,
      projectId: invoice.projectId,
      userId: user.id,
      recordType: 'credit_note',
      recordId: note.id,
      actionType: 'created',
      newValue: {
        creditNoteNumber,
        invoiceNumber: invoice.invoiceNumber,
        reason: parsed.reason,
        ...lines,
      },
    });

    return note;
  });
}

export const issueCreditNoteSchema = z.object({
  creditNoteId: z.string().uuid(),
  issuedOn: z.coerce.date(),
});

/**
 * Issues it. From here the figures move: what the client owes, what has been
 * applied for, and what retention is held all come down.
 */
export async function issueCreditNote(
  user: AuthenticatedUser,
  input: z.infer<typeof issueCreditNoteSchema>,
) {
  const parsed = issueCreditNoteSchema.parse(input);

  const note = await prisma.creditNote.findUnique({
    where: { id: parsed.creditNoteId },
    include: {
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          grossThisPeriod: true,
          creditNotes: { select: { status: true, grossAmount: true, id: true } },
        },
      },
    },
  });
  if (!note) throw new NotFoundError('Credit note not found');

  await assertProjectAccess(user, note.projectId, 'invoice.manage');

  if (note.status === 'issued') return note;
  if (note.status === 'cancelled') {
    throw new ValidationError('That credit note was cancelled. Raise a new one.');
  }

  const endOfToday = new Date(todayUtc());
  endOfToday.setUTCDate(endOfToday.getUTCDate() + 1);
  if (parsed.issuedOn.getTime() >= endOfToday.getTime()) {
    throw new ValidationError('A credit note cannot be dated in the future.');
  }

  // Re-checked at issue, not only at draft. Two drafts raised on the same
  // invoice can each be within the limit alone and over it together, and the
  // one that would tip it over must fail here rather than on a report six
  // weeks later.
  const others = note.invoice.creditNotes.filter((other) => other.id !== note.id);
  const available = creditableGross(note.invoice.grossThisPeriod.toString(), others);
  if (toFils(note.grossAmount.toString()) > toFils(available)) {
    throw new ValidationError(
      `Another credit has been issued against ${note.invoice.invoiceNumber} since this was ` +
        `drafted. Only ${available} is left to credit.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.creditNote.update({
      where: { id: note.id },
      data: { status: 'issued', issuedAt: parsed.issuedOn, issuedByUserId: user.id },
    });

    // The invoice may now be settled by the credit alone.
    await refreshInvoiceSettlement(tx, note.invoiceId);

    await recordAudit({
      db: tx,
      projectId: note.projectId,
      userId: user.id,
      recordType: 'credit_note',
      recordId: note.id,
      actionType: 'issued',
      newValue: {
        creditNoteNumber: note.creditNoteNumber,
        invoiceNumber: note.invoice.invoiceNumber,
        totalCredited: note.totalCredited.toString(),
        issuedOn: parsed.issuedOn.toISOString().slice(0, 10),
      },
    });

    return updated;
  });
}

export const cancelCreditNoteSchema = z.object({
  creditNoteId: z.string().uuid(),
  reason: z.string().trim().min(3, 'Say why it is being cancelled').max(2000),
});

/**
 * Cancels a credit note that was raised in error.
 *
 * Only a DRAFT. Once a credit has been issued the client has it, and taking it
 * back is a new invoice, not an undo — the same rule that stops an issued
 * application from being edited.
 */
export async function cancelCreditNote(
  user: AuthenticatedUser,
  input: z.infer<typeof cancelCreditNoteSchema>,
) {
  const parsed = cancelCreditNoteSchema.parse(input);

  const note = await prisma.creditNote.findUnique({ where: { id: parsed.creditNoteId } });
  if (!note) throw new NotFoundError('Credit note not found');

  await assertProjectAccess(user, note.projectId, 'invoice.manage');

  if (note.status === 'cancelled') return note;
  if (note.status === 'issued') {
    throw new ValidationError(
      'That credit note has been issued and the client has it. ' +
        'Raise an application for the amount rather than cancelling the credit.',
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.creditNote.update({
      where: { id: note.id },
      data: { status: 'cancelled', cancelledAt: new Date(), cancelledReason: parsed.reason },
    });

    await recordAudit({
      db: tx,
      projectId: note.projectId,
      userId: user.id,
      recordType: 'credit_note',
      recordId: note.id,
      actionType: 'updated',
      oldValue: { status: note.status },
      newValue: { status: 'cancelled', reason: parsed.reason },
    });

    return updated;
  });
}

export async function listCreditNotes(
  user: AuthenticatedUser,
  filters: { projectId?: string; invoiceId?: string } = {},
) {
  const scope = await scopeToUser(user);
  const where: Prisma.CreditNoteWhereInput = { ...scope };

  if (filters.projectId) {
    await assertProjectAccess(user, filters.projectId);
    where.projectId = filters.projectId;
  }
  if (filters.invoiceId) where.invoiceId = filters.invoiceId;

  return prisma.creditNote.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }],
    include: {
      project: { select: { id: true, projectCode: true, currency: true } },
      invoice: { select: { id: true, invoiceNumber: true, totalDue: true } },
      issuedBy: { select: { fullName: true } },
    },
  });
}

/* ─── Shared arithmetic, exported because three services need it ─────────── */

/** Only issued credits count. A draft has changed nothing anywhere. */
export function issuedCredits<T extends { status: string }>(notes: T[]): T[] {
  return notes.filter((note) => note.status === 'issued');
}

/**
 * How much of an invoice's gross is still creditable.
 *
 * Drafts are counted as well as issued ones. Two drafts that are each within
 * the limit alone and over it together would otherwise both be raised, and the
 * second would fail at issue after somebody had already approved it.
 */
export function creditableGross(
  invoiceGross: string,
  notes: { status: string; grossAmount: { toString(): string } }[],
): string {
  const claimed = sumDecimals(
    notes
      .filter((note) => note.status !== 'cancelled')
      .map((note) => note.grossAmount.toString()),
  );
  const left = subtractDecimals(invoiceGross, claimed);
  return left.startsWith('-') ? '0.00' : left;
}

/**
 * Re-sets an invoice's status after a credit changes what is owed on it.
 *
 * The status still follows the MONEY: an invoice nobody has paid stays
 * `issued`, even when a credit has taken the whole of it away. Calling that
 * "paid" would put a receipt in the ledger that never happened. What the
 * credit changes is the OUTSTANDING figure, which is computed on read and is
 * what the chase and the overdue report actually use.
 */
export async function refreshInvoiceSettlement(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<void> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      payments: { select: { amount: true } },
      creditNotes: { select: { status: true, totalCredited: true } },
    },
  });
  if (!invoice) return;
  if (invoice.status === 'draft' || invoice.status === 'cancelled') return;

  const paid = toFils(sumDecimals(invoice.payments.map((p) => p.amount.toString())));
  const credited = toFils(
    sumDecimals(issuedCredits(invoice.creditNotes).map((n) => n.totalCredited.toString())),
  );
  const demand = toFils(invoice.totalDue.toString()) - credited;

  const status = paid <= 0 ? 'issued' : paid >= demand ? 'paid' : 'part_paid';

  if (status !== invoice.status) {
    await tx.invoice.update({ where: { id: invoiceId }, data: { status } });
  }
}
