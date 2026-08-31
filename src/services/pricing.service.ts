import 'server-only';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { todayUtc } from '@/lib/dates';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit } from '@/services/audit-log.service';
import { assertProjectAccess } from '@/services/project-access.service';
import { hasCapability } from '@/services/permissions.service';
import { openGate } from '@/services/approval.service';
import { enterStage } from '@/services/stage.service';

/**
 * What the quantity surveyor actually does.
 *
 * Two outcomes, and the second one is not a failure. A QS reading a change
 * against the contract either finds work the client owes money for, or finds
 * work already covered by what was priced. "Not a variation" is a real,
 * frequent and valuable answer — it is the one that stops the company claiming
 * for something it already sold, which is how a contractor loses credibility
 * on the claims that do matter.
 *
 * ── Every number is computed here ──────────────────────────────────────────
 * Line amounts, the net, prelims, overhead and profit, and the total. Never in
 * the browser, never in a template. A figure that is right on screen and
 * different in the database is discovered during a payment dispute, and by
 * then it is not an arithmetic problem.
 *
 * Decimal throughout, never a float. 0.1 + 0.2 is a rounding curiosity in most
 * software and a wrong invoice here.
 *
 * ── Submission freezes the figure ──────────────────────────────────────────
 * `submittedValue` is written once and never recomputed. Two directors approve
 * a number; that number has to still be the number afterwards, whatever anyone
 * later does to the line items. Editing after submission is refused outright —
 * the route back is a rejection at the gate, which is visible.
 */

export const lineItemSchema = z.object({
  description: z.string().trim().min(3, 'Describe the item').max(300),
  quantity: z.coerce.number().positive('Quantity must be more than zero'),
  unit: z.string().trim().min(1).max(20).default('no'),
  rate: z.coerce.number().min(0, 'A rate cannot be negative'),
  rateSource: z.enum(['contract_boq', 'pro_rata', 'star_rate', 'quotation', 'daywork']),
  category: z.enum(['labour', 'material', 'plant', 'subcontractor', 'other']).default('other'),
  boqReference: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export type LineItemInput = z.infer<typeof lineItemSchema>;

export const pricingRatesSchema = z.object({
  prelimsPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  overheadProfitPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  pricingNotes: z.string().trim().max(4000).optional().nullable(),
});

export const notAVariationSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(15, 'Say which part of the contract already covers this. It will be challenged.')
    .max(2000),
});

const TWO_DP = 2;

function round(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(TWO_DP, Prisma.Decimal.ROUND_HALF_UP);
}

export interface PricingTotals {
  net: string;
  prelims: string;
  overheadProfit: string;
  total: string;
  /** Present so the page never has to add anything up itself. */
  byCategory: { category: string; amount: string }[];
  starRateCount: number;
}

/**
 * The build-up, and its arithmetic.
 *
 * Prelims are taken on the net. Overhead and profit are taken on the net PLUS
 * prelims, which is the ordinary UAE fit-out convention and the one that makes
 * the two percentages non-interchangeable. Stating it here rather than leaving
 * it implicit, because getting it the other way round quietly understates every
 * variation the company ever submits.
 */
export function computeTotals(
  items: { amount: Prisma.Decimal; category: string; rateSource: string }[],
  prelimsPercent: Prisma.Decimal | null,
  ohpPercent: Prisma.Decimal | null,
): PricingTotals {
  const net = items.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
  const prelims = round(net.times(prelimsPercent ?? 0).dividedBy(100));
  const overheadProfit = round(net.plus(prelims).times(ohpPercent ?? 0).dividedBy(100));
  const total = round(net.plus(prelims).plus(overheadProfit));

  const buckets = new Map<string, Prisma.Decimal>();
  for (const item of items) {
    buckets.set(item.category, (buckets.get(item.category) ?? new Prisma.Decimal(0)).plus(item.amount));
  }

  return {
    net: round(net).toFixed(TWO_DP),
    prelims: prelims.toFixed(TWO_DP),
    overheadProfit: overheadProfit.toFixed(TWO_DP),
    total: total.toFixed(TWO_DP),
    byCategory: [...buckets.entries()].map(([category, amount]) => ({
      category,
      amount: round(amount).toFixed(TWO_DP),
    })),
    // Surfaced because a build-up resting on new rates is the one that gets
    // argued, and knowing that BEFORE it goes to the client is worth something.
    starRateCount: items.filter((item) => item.rateSource === 'star_rate').length,
  };
}

async function loadForPricing(user: AuthenticatedUser, potentialChangeId: string) {
  const change = await prisma.potentialChange.findUnique({
    where: { id: potentialChangeId },
    select: {
      id: true,
      projectId: true,
      pcNumber: true,
      title: true,
      currentStatus: true,
      pricingStatus: true,
      prelimsPercent: true,
      overheadProfitPercent: true,
    },
  });
  if (!change) throw new NotFoundError('Potential Change not found');

  const { projectRoles } = await assertProjectAccess(user, change.projectId);
  if (!(await hasCapability(user.systemRole, projectRoles, 'pricing.submit'))) {
    throw new ForbiddenError('You are not permitted to price changes.');
  }
  return change;
}

function assertOpenForPricing(pricingStatus: string): void {
  if (pricingStatus === 'submitted') {
    throw new ValidationError(
      'This price has been submitted and is with the approvers. Changing it now would mean they are deciding on a figure that no longer exists. If it is wrong, ask them to reject it.',
    );
  }
  if (pricingStatus === 'approved') {
    throw new ValidationError('This variation has been approved. Its price is fixed.');
  }
}

export async function getPricing(user: AuthenticatedUser, potentialChangeId: string) {
  const change = await prisma.potentialChange.findUnique({
    where: { id: potentialChangeId },
    select: { id: true, projectId: true, pricingStatus: true, prelimsPercent: true, overheadProfitPercent: true, submittedValue: true, submittedAt: true, pricingNotes: true },
  });
  if (!change) throw new NotFoundError('Potential Change not found');
  await assertProjectAccess(user, change.projectId);

  const items = await prisma.pricingLineItem.findMany({
    where: { potentialChangeId },
    orderBy: { sequence: 'asc' },
  });

  return {
    ...change,
    items,
    totals: computeTotals(items, change.prelimsPercent, change.overheadProfitPercent),
  };
}

export async function addLineItem(
  user: AuthenticatedUser,
  potentialChangeId: string,
  input: LineItemInput,
) {
  const change = await loadForPricing(user, potentialChangeId);
  assertOpenForPricing(change.pricingStatus);
  const parsed = lineItemSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const last = await tx.pricingLineItem.findFirst({
      where: { potentialChangeId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });

    const quantity = new Prisma.Decimal(parsed.quantity);
    const rate = new Prisma.Decimal(parsed.rate);

    const item = await tx.pricingLineItem.create({
      data: {
        potentialChangeId,
        projectId: change.projectId,
        sequence: (last?.sequence ?? 0) + 1,
        description: parsed.description,
        quantity,
        unit: parsed.unit,
        rate,
        amount: round(quantity.times(rate)),
        rateSource: parsed.rateSource,
        category: parsed.category,
        boqReference: parsed.boqReference ?? null,
        notes: parsed.notes ?? null,
      },
    });

    if (change.pricingStatus === 'not_started') {
      await tx.potentialChange.update({
        where: { id: potentialChangeId },
        data: { pricingStatus: 'draft' },
      });
    }

    await recordAudit({
      db: tx,
      projectId: change.projectId,
      userId: user.id,
      recordType: 'potential_change',
      recordId: potentialChangeId,
      actionType: 'updated',
      newValue: {
        pricingLineAdded: parsed.description,
        amount: item.amount.toFixed(TWO_DP),
        rateSource: parsed.rateSource,
      },
    });

    return item;
  });
}

export async function removeLineItem(
  user: AuthenticatedUser,
  potentialChangeId: string,
  lineItemId: string,
) {
  const change = await loadForPricing(user, potentialChangeId);
  assertOpenForPricing(change.pricingStatus);

  // Scoped by change id as well as its own: an id from another project must
  // not delete anything here.
  const deleted = await prisma.pricingLineItem.deleteMany({
    where: { id: lineItemId, potentialChangeId },
  });
  if (deleted.count === 0) throw new NotFoundError('Line item not found');

  await recordAudit({
    projectId: change.projectId,
    userId: user.id,
    recordType: 'potential_change',
    recordId: potentialChangeId,
    actionType: 'updated',
    newValue: { pricingLineRemoved: lineItemId },
  });
}

export async function setPricingRates(
  user: AuthenticatedUser,
  potentialChangeId: string,
  input: z.infer<typeof pricingRatesSchema>,
) {
  const change = await loadForPricing(user, potentialChangeId);
  assertOpenForPricing(change.pricingStatus);
  const parsed = pricingRatesSchema.parse(input);

  return prisma.potentialChange.update({
    where: { id: potentialChangeId },
    data: {
      prelimsPercent: parsed.prelimsPercent ?? null,
      overheadProfitPercent: parsed.overheadProfitPercent ?? null,
      pricingNotes: parsed.pricingNotes ?? null,
      pricingStatus: change.pricingStatus === 'not_started' ? 'draft' : change.pricingStatus,
    },
  });
}

/**
 * Submitting the price. This is what opens the final approval gate — not a
 * dropdown, for the same reason no other gate can be walked around.
 */
export async function submitPricing(user: AuthenticatedUser, potentialChangeId: string) {
  const change = await loadForPricing(user, potentialChangeId);
  assertOpenForPricing(change.pricingStatus);

  const items = await prisma.pricingLineItem.findMany({
    where: { potentialChangeId },
    select: { amount: true, category: true, rateSource: true },
  });
  if (items.length === 0) {
    throw new ValidationError(
      'There is nothing to approve yet. Add at least one priced item, or record it as not a variation.',
    );
  }

  const totals = computeTotals(items, change.prelimsPercent, change.overheadProfitPercent);

  return prisma.$transaction(async (tx) => {
    await tx.potentialChange.update({
      where: { id: potentialChangeId },
      data: {
        pricingStatus: 'submitted',
        submittedValue: new Prisma.Decimal(totals.total),
        submittedAt: new Date(),
        submittedByUserId: user.id,
        // Kept in step so registers and dashboards that read estimatedValue
        // do not go on showing a figure nobody stands behind.
        estimatedValue: new Prisma.Decimal(totals.total),
        currentStatus: 'internal_approval',
      },
    });

    await tx.task.updateMany({
      where: {
        potentialChangeId,
        taskType: 'qs_pricing',
        status: { in: ['open', 'in_progress'] },
      },
      data: { status: 'completed', completedAt: new Date() },
    });

    await openGate(tx, {
      potentialChangeId,
      projectId: change.projectId,
      gate: 'final_variation',
      pcNumber: change.pcNumber,
      title: change.title,
      dueDate: todayUtc(),
      openedByUserId: user.id,
    });

    await recordAudit({
      db: tx,
      projectId: change.projectId,
      userId: user.id,
      recordType: 'potential_change',
      recordId: potentialChangeId,
      actionType: 'status_changed',
      oldValue: { currentStatus: change.currentStatus, pricingStatus: change.pricingStatus },
      newValue: {
        currentStatus: 'internal_approval',
        pricingStatus: 'submitted',
        submittedValue: totals.total,
        starRateItems: totals.starRateCount,
      },
    });

    return totals;
  });
}

/**
 * The other outcome: the work is already in the contract, so there is no claim.
 *
 * Ends the change at `included_scope` — which is what that status has always
 * meant, and is the opposite of an approved variation. It needs a reason of
 * real substance because it gives away money the company might have been owed,
 * and because the site engineer who raised it deserves to know why it went
 * nowhere.
 */
export async function recordNotAVariation(
  user: AuthenticatedUser,
  potentialChangeId: string,
  input: z.infer<typeof notAVariationSchema>,
) {
  const change = await loadForPricing(user, potentialChangeId);
  assertOpenForPricing(change.pricingStatus);
  const parsed = notAVariationSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.potentialChange.update({
      where: { id: potentialChangeId },
      data: {
        currentStatus: 'included_scope',
        pricingStatus: 'not_started',
        submittedValue: null,
        estimatedValue: null,
        pricingNotes: parsed.reason,
      },
    });

    await tx.task.updateMany({
      where: { potentialChangeId, status: { in: ['open', 'in_progress', 'blocked'] } },
      data: { status: 'completed', completedAt: new Date() },
    });

    await enterStage(tx, {
      potentialChangeId,
      projectId: change.projectId,
      pcNumber: change.pcNumber,
      title: change.title,
      status: 'included_scope',
      actorUserId: user.id,
    });

    await recordAudit({
      db: tx,
      projectId: change.projectId,
      userId: user.id,
      recordType: 'potential_change',
      recordId: potentialChangeId,
      actionType: 'status_changed',
      oldValue: { currentStatus: change.currentStatus },
      newValue: { currentStatus: 'included_scope', notAVariation: true },
      metadata: { reason: parsed.reason },
    });

    return updated;
  });
}
