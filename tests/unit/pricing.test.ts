import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

/**
 * The arithmetic, tested on its own.
 *
 * These are the only numbers in the product that turn into an invoice. Two
 * things have to be right and neither is obvious:
 *
 *   · overhead and profit are taken on the net PLUS preliminaries, not on the
 *     net alone. The other way round quietly understates every variation the
 *     company ever submits, by a consistent amount nobody notices.
 *   · Decimal, never a float. 0.1 + 0.2 is a curiosity in most software and a
 *     wrong invoice here.
 */

vi.mock('server-only', () => ({}));

const { computeTotals } = await import('@/services/pricing.service');

function line(amount: string, category = 'material', rateSource = 'contract_boq') {
  return { amount: new Prisma.Decimal(amount), category, rateSource };
}

describe('the build-up', () => {
  it('adds the lines up', () => {
    const totals = computeTotals([line('1000.00'), line('250.50')], null, null);
    expect(totals.net).toBe('1250.50');
    expect(totals.total).toBe('1250.50');
  });

  it('takes preliminaries on the net', () => {
    const totals = computeTotals([line('1000.00')], new Prisma.Decimal(10), null);
    expect(totals.prelims).toBe('100.00');
    expect(totals.total).toBe('1100.00');
  });

  // 1000 net, 10% prelims = 100, then 15% OHP on 1100 = 165. Taking 15% on the
  // net alone would give 150 — fifteen dirhams short on a thousand, every time.
  it('takes overhead and profit on the net plus preliminaries', () => {
    const totals = computeTotals(
      [line('1000.00')],
      new Prisma.Decimal(10),
      new Prisma.Decimal(15),
    );
    expect(totals.prelims).toBe('100.00');
    expect(totals.overheadProfit).toBe('165.00');
    expect(totals.total).toBe('1265.00');
  });

  it('does not drift the way floating point does', () => {
    const totals = computeTotals([line('0.10'), line('0.20')], null, null);
    expect(totals.net).toBe('0.30');
  });

  it('rounds half up, to the fils', () => {
    const totals = computeTotals([line('100.00')], new Prisma.Decimal('3.335'), null);
    expect(totals.prelims).toBe('3.34');
  });

  it('treats missing percentages as nothing, not as an error', () => {
    const totals = computeTotals([line('500.00')], null, null);
    expect(totals.prelims).toBe('0.00');
    expect(totals.overheadProfit).toBe('0.00');
    expect(totals.total).toBe('500.00');
  });

  it('splits the total by category so the build-up can be read', () => {
    const totals = computeTotals(
      [line('100.00', 'labour'), line('300.00', 'material'), line('50.00', 'labour')],
      null,
      null,
    );
    const labour = totals.byCategory.find((b) => b.category === 'labour');
    expect(labour?.amount).toBe('150.00');
  });

  // A build-up resting on new rates is the one that gets argued, and knowing
  // that BEFORE it goes to the client is worth something.
  it('counts the lines resting on a rate that still has to be agreed', () => {
    const totals = computeTotals(
      [
        line('100.00', 'material', 'contract_boq'),
        line('200.00', 'material', 'star_rate'),
        line('300.00', 'labour', 'star_rate'),
      ],
      null,
      null,
    );
    expect(totals.starRateCount).toBe(2);
  });

  it('handles an empty build-up without pretending it is worth something', () => {
    const totals = computeTotals([], new Prisma.Decimal(10), new Prisma.Decimal(15));
    expect(totals.net).toBe('0.00');
    expect(totals.total).toBe('0.00');
  });
});
