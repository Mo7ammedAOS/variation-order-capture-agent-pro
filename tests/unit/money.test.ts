import { describe, expect, it } from 'vitest';
import {
  calculateApplication,
  fromFils,
  percentOf,
  subtractDecimals,
  sumDecimals,
  toFils,
} from '@/lib/money';
import { formatInvoiceNumber, formatVoNumber } from '@/lib/pc-number';

/**
 * These are the sums that end up on a tax invoice.
 *
 * Every case below is one a person could do on paper and check. That is the
 * standard: if a figure here disagrees with what somebody works out with a
 * calculator, the software is wrong, not the person — and the argument will
 * happen in front of a client who is deciding whether to pay.
 */

describe('parsing and printing money', () => {
  it('keeps two decimals exactly', () => {
    expect(toFils('120000.00')).toBe(12_000_000);
    expect(toFils('0.05')).toBe(5);
    expect(fromFils(12_000_000)).toBe('120000.00');
    expect(fromFils(5)).toBe('0.05');
  });

  it('does not drift where floating point does', () => {
    // 0.1 + 0.2 is the canonical example, and on an invoice it is a wrong total.
    expect(sumDecimals(['0.10', '0.20'])).toBe('0.30');
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('adds a long column without accumulating error', () => {
    const rows = Array.from({ length: 1000 }, () => '0.01');
    expect(sumDecimals(rows)).toBe('10.00');
  });

  it('drops a third decimal rather than rounding it', () => {
    // A figure entered to three places was entered wrongly. Rounding it here
    // would hide that from whoever has to reconcile it later.
    expect(toFils('10.999')).toBe(1099);
  });

  it('refuses anything that is not a number', () => {
    expect(() => toFils('AED 500')).toThrow();
    expect(() => toFils('')).toThrow();
    expect(() => toFils('1,000.00')).toThrow();
  });

  it('rounds half up, away from zero, as a person would', () => {
    expect(percentOf(toFils('10.05'), 50)).toBe(503); // 5.025 -> 5.03
    expect(percentOf(toFils('0.05'), 50)).toBe(3); // 0.025 -> 0.03
  });

  it('subtracts without going through a float', () => {
    expect(subtractDecimals('120000.00', '95000.00')).toBe('25000.00');
    expect(subtractDecimals('95000.00', '120000.00')).toBe('-25000.00');
  });
});

describe('a progress application', () => {
  const base = {
    basisValue: '120000.00',
    previouslyApplied: '0.00',
    retentionPercent: '5',
    vatPercent: '5',
  };

  it('works the first application out the way a QS would', () => {
    const lines = calculateApplication({ ...base, cumulativePercent: '40' });

    //   40% of 120,000            = 48,000.00
    //   less 5% retention 2,400   = 45,600.00
    //   plus 5% VAT on the net    =  2,280.00
    //                       total = 47,880.00
    expect(lines.grossThisPeriod).toBe('48000.00');
    expect(lines.retentionAmount).toBe('2400.00');
    expect(lines.netValue).toBe('45600.00');
    expect(lines.vatAmount).toBe('2280.00');
    expect(lines.totalDue).toBe('47880.00');
  });

  it('claims only what is new, not the cumulative figure again', () => {
    const lines = calculateApplication({
      ...base,
      cumulativePercent: '75',
      previouslyApplied: '48000.00',
    });

    // 75% of 120,000 = 90,000, less the 48,000 already certified.
    expect(lines.grossThisPeriod).toBe('42000.00');
  });

  it('always shows a total that equals the two figures printed above it', () => {
    // The reason VAT is charged on the ROUNDED net: otherwise the invoice
    // shows three numbers where the first two do not make the third.
    const lines = calculateApplication({
      basisValue: '33333.33',
      cumulativePercent: '33.33',
      previouslyApplied: '0.00',
      retentionPercent: '7.5',
      vatPercent: '5',
    });

    expect(sumDecimals([lines.netValue, lines.vatAmount])).toBe(lines.totalDue);
    expect(sumDecimals([lines.netValue, lines.retentionAmount])).toBe(lines.grossThisPeriod);
  });

  it('lets the last application clear the balance to the fils', () => {
    const first = calculateApplication({ ...base, cumulativePercent: '33.33' });
    const second = calculateApplication({
      ...base,
      cumulativePercent: '100',
      previouslyApplied: first.grossThisPeriod,
    });

    expect(sumDecimals([first.grossThisPeriod, second.grossThisPeriod])).toBe('120000.00');
  });

  it('refuses to go backwards instead of writing a negative invoice', () => {
    expect(() =>
      calculateApplication({ ...base, cumulativePercent: '30', previouslyApplied: '48000.00' }),
    ).toThrow(/already been applied for/);
  });

  it('refuses a percentage outside 0 to 100', () => {
    expect(() => calculateApplication({ ...base, cumulativePercent: '101' })).toThrow();
    expect(() => calculateApplication({ ...base, cumulativePercent: '-1' })).toThrow();
  });

  it('handles a zero-rated deployment without dividing by anything', () => {
    const lines = calculateApplication({
      ...base,
      cumulativePercent: '100',
      vatPercent: '0',
      retentionPercent: '0',
    });

    expect(lines.retentionAmount).toBe('0.00');
    expect(lines.vatAmount).toBe('0.00');
    expect(lines.totalDue).toBe('120000.00');
  });

  it('handles 10% retention, which is as ordinary here as 5%', () => {
    const lines = calculateApplication({
      ...base,
      cumulativePercent: '50',
      retentionPercent: '10',
    });

    expect(lines.grossThisPeriod).toBe('60000.00');
    expect(lines.retentionAmount).toBe('6000.00');
    expect(lines.netValue).toBe('54000.00');
  });
});

describe('the three number series', () => {
  it('are separate, so renumbering one never moves another', () => {
    expect(formatVoNumber('DXB-001', 7)).toBe('VO-DXB-001-0007');
    expect(formatInvoiceNumber('DXB-001', 7)).toBe('INV-DXB-001-0007');
  });

  it('refuse a sequence that was never allocated', () => {
    expect(() => formatVoNumber('DXB-001', 0)).toThrow();
    expect(() => formatInvoiceNumber('DXB-001', -1)).toThrow();
  });
});
