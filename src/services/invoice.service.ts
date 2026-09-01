import 'server-only';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { todayUtc } from '@/lib/dates';
import { formatInvoiceNumber } from '@/lib/pc-number';
import {
  calculateApplication,
  calculateRetentionRelease,
  fromFils,
  percentOf,
  subtractDecimals,
  sumDecimals,
  toFils,
} from '@/lib/money';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit } from '@/services/audit-log.service';
import { assertProjectAccess, scopeToUser } from '@/services/project-access.service';
import { issuedCredits } from '@/services/credit-note.service';

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
      invoices: {
        select: {
          id: true,
          status: true,
          kind: true,
          grossThisPeriod: true,
          cumulativePercent: true,
          creditNotes: { select: { status: true, grossAmount: true } },
        },
      },
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
  // by that amount, silently. Retention releases are excluded too — a release
  // carries no work value, and counting it as applied-for would make the job
  // look 110% complete the day retention came back.
  const live = vo.invoices.filter(
    (invoice) => invoice.status !== 'cancelled' && invoice.kind === 'application',
  );
  const grossApplied = sumDecimals(live.map((invoice) => invoice.grossThisPeriod.toString()));

  // Issued credits come off. This is what makes a correction usable: without
  // it, crediting an over-certification would leave the credited amount still
  // counted as applied for, and the work could never be billed again.
  const credited = sumDecimals(
    live.flatMap((invoice) =>
      issuedCredits(invoice.creditNotes).map((note) => note.grossAmount.toString()),
    ),
  );
  const previouslyApplied = subtractDecimals(grossApplied, credited);

  // The completion guard is measured in MONEY, not in the highest percentage
  // anybody typed. After a credit the percentage on the paper is still 75 but
  // the money behind it is not, and blocking the next application on a stale
  // percentage would make a corrected invoice impossible to follow.
  const basisFils = toFils(basisValue);
  const effectivePercent =
    basisFils > 0 ? (toFils(previouslyApplied) / basisFils) * 100 : 0;
  if (parsed.cumulativePercent < effectivePercent - 0.001) {
    throw new ValidationError(
      `Applications on this variation already account for ${effectivePercent.toFixed(2)}%. ` +
        'Completion cannot go backwards. Raise a credit note if an earlier one was too high.',
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
        kind: 'application',
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

/* ─── Retention coming back ──────────────────────────────────────────────── */

/**
 * Anything that can state its own value.
 *
 * Deliberately looser than `Prisma.Decimal`. Every function here does exactly
 * one thing with an amount — reads it as a string and hands it to `lib/money`,
 * which parses to integer fils. Demanding a Decimal would buy no safety and
 * would stop the same arithmetic being checked against plain strings.
 */
type Amountish = { toString(): string };

interface RetentionRow {
  status: string;
  retentionAmount: Amountish;
  retentionReleased: Amountish;
  creditNotes?: { status: string; retentionAmount: Amountish }[];
  [extra: string]: unknown;
}

export const retentionReleaseSchema = z.object({
  variationOrderId: z.string().uuid(),
  stage: z.enum(['practical_completion', 'defects_liability_end']),
  periodEnd: z.coerce.date(),
  /** Blank releases everything the stage entitles. */
  amount: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export type RetentionReleaseInput = z.infer<typeof retentionReleaseSchema>;

/**
 * How much retention is held on a variation, and how much has come back.
 *
 * Computed from the rows every time, like every other figure here. Retention
 * is money the company has earned and the client is holding, and a cached
 * number for that which quietly stopped updating would be a number somebody
 * chases a client over.
 */
export function retentionOn(
  // Extra properties are tolerated on purpose: callers pass whole invoice rows
  // from three different queries, and widening this to match each of them
  // would couple the arithmetic to whatever the caller happened to select.
  invoices: RetentionRow[],
): { withheld: string; released: string; held: string } {
  const live = invoices.filter((invoice) => invoice.status !== 'cancelled');

  // Retention credited back is retention no longer held. A credit gives back
  // the retention that was withheld on the amount being credited, so leaving
  // it in the held figure would overstate what the client still owes.
  const creditedRetention = sumDecimals(
    live.flatMap((invoice) =>
      issuedCredits(invoice.creditNotes ?? []).map((note) => note.retentionAmount.toString()),
    ),
  );

  const withheld = subtractDecimals(
    sumDecimals(live.map((invoice) => invoice.retentionAmount.toString())),
    creditedRetention,
  );
  const released = sumDecimals(live.map((invoice) => invoice.retentionReleased.toString()));
  const held = subtractDecimals(withheld, released);

  return {
    withheld,
    released,
    held: held.startsWith('-') ? '0.00' : held,
  };
}

/**
 * Drafts the invoice that brings retention back.
 *
 * ── Why this is an invoice and not a status flag ───────────────────────────
 * The client has to be asked for it, it attracts VAT, it falls due on the
 * payment terms, and it goes overdue like anything else. Everything an
 * application does, a release does — which is why it shares the table rather
 * than living in a corner of its own with its own half-built chasing.
 *
 * What it does NOT share is work value. `grossThisPeriod` is zero and
 * `cumulativePercent` is zero, because no work was done to earn it; the work
 * was done months ago and paid for less this money. Recording a release as
 * turnover would count the same job twice.
 *
 * ── Two moieties ──────────────────────────────────────────────────────────
 * Half at practical completion and the rest at the end of the defects
 * liability period is the UAE fit-out norm, and both are contractual rather
 * than discretionary. The split comes from the project's contract rules; the
 * amount can be overridden, but never beyond what is actually held.
 */
export async function draftRetentionRelease(
  user: AuthenticatedUser,
  input: RetentionReleaseInput,
) {
  const parsed = retentionReleaseSchema.parse(input);

  const vo = await prisma.variationOrder.findUnique({
    where: { id: parsed.variationOrderId },
    include: {
      project: { select: { id: true, projectCode: true, contractRules: true } },
      invoices: {
        select: {
          status: true,
          kind: true,
          retentionStage: true,
          retentionAmount: true,
          retentionReleased: true,
          creditNotes: { select: { status: true, retentionAmount: true } },
        },
      },
    },
  });
  if (!vo) throw new NotFoundError('Variation order not found');

  await assertProjectAccess(user, vo.projectId, 'invoice.manage');

  const position = retentionOn(vo.invoices);
  if (toFils(position.held) <= 0) {
    throw new ValidationError('There is no retention held on this variation.');
  }

  // The same moiety twice is the mistake this catches. Releasing at practical
  // completion, then releasing at practical completion again, would hand back
  // the defects moiety a year early and nobody would notice until the end of
  // the job.
  const already = vo.invoices.some(
    (invoice) =>
      invoice.status !== 'cancelled' &&
      invoice.kind === 'retention_release' &&
      invoice.retentionStage === parsed.stage,
  );
  if (already) {
    throw new ValidationError(
      `Retention has already been released at ${parsed.stage.replace(/_/g, ' ')} on this variation.`,
    );
  }

  const rules = vo.project.contractRules;
  const stagePercent =
    parsed.stage === 'practical_completion'
      ? Number(rules?.retentionReleasePercentAtPc?.toString() ?? '50')
      : 100;

  // At practical completion the entitlement is a share of what was withheld,
  // not of what is left. At the end of the defects period it is the remainder,
  // whatever that turns out to be.
  const entitled =
    parsed.stage === 'practical_completion'
      ? minDecimal(percentOfDecimal(position.withheld, stagePercent), position.held)
      : position.held;

  const amount = parsed.amount?.trim() ? parsed.amount.trim() : entitled;

  if (toFils(amount) <= 0) throw new ValidationError('A retention release must be more than zero');
  if (toFils(amount) > toFils(position.held)) {
    throw new ValidationError(
      `Only ${position.held} of retention is held on this variation. ` +
        'Releasing more would be asking the client for money that was never withheld.',
    );
  }

  const company = await prisma.companySettings.findFirst({ where: { singleton: true } });
  const vatPercent = company?.vatPercent?.toString() ?? '5';

  const lines = calculateRetentionRelease({ amount, vatPercent });

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
        kind: 'retention_release',
        retentionStage: parsed.stage,
        periodEnd: parsed.periodEnd,
        // No work value. All four of these are zero on a release and that is
        // the point: the money was earned when the work was done.
        cumulativePercent: new Prisma.Decimal(0),
        basisValue: vo.approvedValue ?? new Prisma.Decimal(0),
        previouslyApplied: new Prisma.Decimal(0),
        grossThisPeriod: new Prisma.Decimal(0),
        retentionPercent: new Prisma.Decimal(0),
        retentionAmount: new Prisma.Decimal(0),
        retentionReleased: new Prisma.Decimal(lines.retentionReleased),
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
      newValue: {
        invoiceNumber,
        voNumber: vo.voNumber,
        kind: 'retention_release',
        stage: parsed.stage,
        retentionHeldBefore: position.held,
        ...lines,
      },
    });

    return invoice;
  });
}

function percentOfDecimal(amount: string, percent: number): string {
  return fromFils(percentOf(toFils(amount), percent));
}

function minDecimal(a: string, b: string): string {
  return toFils(a) <= toFils(b) ? a : b;
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
    include: {
      _count: { select: { payments: true } },
      creditNotes: { select: { status: true, creditNoteNumber: true } },
    },
  });
  if (!invoice) throw new NotFoundError('Invoice not found');

  await assertProjectAccess(user, invoice.projectId, 'invoice.manage');

  if (invoice._count.payments > 0) {
    throw new ValidationError(
      'Money has been received against this application. Raise a credit rather than cancelling it.',
    );
  }

  // A credit points at a document. Cancelling the document it points at would
  // leave the client holding a credit note against an invoice that this system
  // says never existed.
  const live = issuedCredits(invoice.creditNotes);
  if (live.length > 0) {
    throw new ValidationError(
      `${live.map((note) => note.creditNoteNumber).join(', ')} already credits this application. ` +
        'Cancelling it now would leave that credit pointing at nothing.',
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
  /** Given back on issued credit notes. */
  creditedTotal: string;
  /** Retention already asked back at a contractual milestone. */
  retentionReleasedTotal: string;
  overdueCount: number;
  unbilledCount: number;
  /** Extension of time, in days. The same shape as the money, deliberately. */
  time: TimePosition;
}

/**
 * The time claim, counted the way the money is.
 *
 * Days are the second currency on a fit-out job and the one that is never
 * added up. A contractor who has conceded ninety days across eleven variations
 * has given away the programme, and until these three figures sit next to each
 * other nobody in the company can see that it happened.
 */
export interface TimePosition {
  /** Days put to the client across every live variation. */
  daysClaimed: number;
  /** Days they agreed. */
  daysApproved: number;
  /** Claimed less approved. What was given up. */
  daysConceded: number;
  /** Variations claiming time that the client has not answered. */
  awaitingCount: number;
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
      timeImpactDaysClaimed: true,
      approvedTimeImpactDays: true,
      clientResponse: true,
      invoices: {
        select: {
          status: true,
          kind: true,
          grossThisPeriod: true,
          retentionAmount: true,
          retentionReleased: true,
          totalDue: true,
          dueAt: true,
          payments: { select: { amount: true } },
          creditNotes: {
            select: {
              status: true,
              grossAmount: true,
              retentionAmount: true,
              totalCredited: true,
            },
          },
        },
      },
    },
  });

  const today = todayUtc();

  let approved = '0.00';
  let applied = '0.00';
  let retentionWithheld = '0.00';
  let retentionReleased = '0.00';
  let invoiced = '0.00';
  let paid = '0.00';
  let overdue = '0.00';
  let shortfall = '0.00';
  let credited = '0.00';
  let overdueCount = 0;
  let unbilledCount = 0;

  let daysClaimed = 0;
  let daysApproved = 0;
  let awaitingCount = 0;

  for (const order of orders) {
    const orderApproved = order.approvedValue?.toString() ?? '0.00';
    approved = sumDecimals([approved, orderApproved]);

    if (order.submittedValue) {
      const gap = subtractDecimals(order.submittedValue.toString(), orderApproved);
      if (!gap.startsWith('-')) shortfall = sumDecimals([shortfall, gap]);
    }

    const claimed = order.timeImpactDaysClaimed ?? 0;
    daysClaimed += claimed;
    daysApproved += order.approvedTimeImpactDays ?? 0;
    if (claimed > 0 && order.clientResponse === 'awaiting') awaitingCount += 1;

    let orderApplied = '0.00';

    for (const invoice of order.invoices) {
      if (invoice.status === 'cancelled') continue;

      // Issued credits only. A draft credit has changed nothing anywhere, and
      // letting one reduce the position would let a figure a director acts on
      // be moved by a document nobody has approved.
      const live = issuedCredits(invoice.creditNotes);
      const creditedGross = sumDecimals(live.map((note) => note.grossAmount.toString()));
      const creditedRetention = sumDecimals(live.map((note) => note.retentionAmount.toString()));
      const creditedTotal = sumDecimals(live.map((note) => note.totalCredited.toString()));

      credited = sumDecimals([credited, creditedTotal]);

      // A release carries no work value, so it never counts as applied for.
      if (invoice.kind === 'application') {
        orderApplied = sumDecimals([
          orderApplied,
          subtractDecimals(invoice.grossThisPeriod.toString(), creditedGross),
        ]);
      }

      retentionWithheld = sumDecimals([
        retentionWithheld,
        subtractDecimals(invoice.retentionAmount.toString(), creditedRetention),
      ]);
      retentionReleased = sumDecimals([retentionReleased, invoice.retentionReleased.toString()]);

      if (invoice.status === 'draft') continue;

      const demand = subtractDecimals(invoice.totalDue.toString(), creditedTotal);
      invoiced = sumDecimals([invoiced, demand]);

      const received = sumDecimals(invoice.payments.map((payment) => payment.amount.toString()));
      paid = sumDecimals([paid, received]);

      const unpaid = subtractDecimals(demand, received);
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
  const held = subtractDecimals(retentionWithheld, retentionReleased);

  return {
    approvedValue: approved,
    appliedValue: applied,
    unbilledValue: unbilled.startsWith('-') ? '0.00' : unbilled,
    retentionHeld: held.startsWith('-') ? '0.00' : held,
    invoicedTotal: invoiced,
    paidTotal: paid,
    outstandingTotal: subtractDecimals(invoiced, paid),
    overdueTotal: overdue,
    shortfallValue: shortfall,
    creditedTotal: credited,
    retentionReleasedTotal: retentionReleased,
    overdueCount,
    unbilledCount,
    time: {
      daysClaimed,
      daysApproved,
      daysConceded: Math.max(0, daysClaimed - daysApproved),
      awaitingCount,
    },
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
