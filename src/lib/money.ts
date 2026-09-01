import { ValidationError } from '@/lib/errors';

/**
 * The arithmetic behind every figure a client is sent.
 *
 * ── Integers, not floats ───────────────────────────────────────────────────
 * Everything here works in fils — hundredths of a dirham, as whole numbers.
 * `0.1 + 0.2` is famously not `0.3` in binary floating point, and a fils of
 * drift is not a rounding curiosity when it appears on an invoice: it is a
 * number that does not add up, in front of the person deciding whether to pay
 * it. Values cross the boundary as decimal strings, are parsed to integers
 * here, and go back as strings.
 *
 * ── Each figure is rounded once, and the next is built on the rounded one ──
 * VAT is charged on the ROUNDED net, not on an unrounded intermediate, and
 * the total is the sum of the two figures printed above it. Otherwise the
 * invoice shows three numbers where the first two do not make the third, and
 * no explanation of floating point will make that acceptable.
 *
 * ── It refuses rather than guesses ─────────────────────────────────────────
 * A percentage above 100, a retention above the gross, a negative basis: all
 * throw. A silently clamped figure is a wrong invoice that nobody notices.
 */

const SCALE = 100;

/** Parses a decimal string or number into whole fils. Rejects anything else. */
export function toFils(value: string | number): number {
  const text = typeof value === 'number' ? value.toString() : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new ValidationError(`"${value}" is not a number this can add up`);
  }

  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const padded = `${fraction}00`.slice(0, 2);
  // The third decimal onward is dropped, not rounded: a figure entered to
  // three places was entered wrongly, and rounding it hides that.
  const fils = Number(whole) * SCALE + Number(padded);
  return negative ? -fils : fils;
}

/** Back to a two-decimal string, which is what the database column holds. */
export function fromFils(fils: number): string {
  const negative = fils < 0;
  const absolute = Math.abs(Math.round(fils));
  const whole = Math.floor(absolute / SCALE);
  const remainder = absolute % SCALE;
  return `${negative ? '-' : ''}${whole}.${String(remainder).padStart(2, '0')}`;
}

/**
 * Half-up, away from zero — the convention on a UAE tax invoice, and the one a
 * person doing it by hand would use. Banker's rounding is defensible in
 * statistics and indefensible when someone is checking your sums.
 */
function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Applies a percentage to an amount in fils, rounded once. */
export function percentOf(amountFils: number, percent: string | number): number {
  const rate = typeof percent === 'number' ? percent : Number(percent);
  if (!Number.isFinite(rate)) {
    throw new ValidationError(`"${percent}" is not a percentage`);
  }
  return roundHalfUp((amountFils * rate) / 100);
}

export interface ApplicationInput {
  /** The agreed VO value this application is measured against. */
  basisValue: string;
  /** Cumulative completion at the period end, 0 to 100. */
  cumulativePercent: string;
  /** Gross certified by every earlier application on this VO. */
  previouslyApplied: string;
  retentionPercent: string;
  vatPercent: string;
}

export interface ApplicationLines {
  grossThisPeriod: string;
  retentionAmount: string;
  netValue: string;
  vatAmount: string;
  totalDue: string;
}

/**
 * One progress application, from a percentage to the figure owed.
 *
 *   cumulative % of the VO
 *   less everything applied for before          = gross this period
 *   less retention                              = net
 *   plus VAT on the net                         = total due
 *
 * That is the order it appears on the paper, and the order it is computed in,
 * so the two can be checked line by line.
 */
export function calculateApplication(input: ApplicationInput): ApplicationLines {
  const basis = toFils(input.basisValue);
  const previous = toFils(input.previouslyApplied);
  const percent = Number(input.cumulativePercent);

  if (basis < 0) throw new ValidationError('A variation cannot have a negative value');
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new ValidationError('Completion must be between 0 and 100 percent');
  }
  if (previous < 0) throw new ValidationError('Previously applied cannot be negative');

  const cumulativeGross = percentOf(basis, percent);
  const grossThisPeriod = cumulativeGross - previous;

  if (grossThisPeriod < 0) {
    // Going backwards means a previous application over-certified, or the
    // percentage was typed wrongly. Either way it is a credit note, which is a
    // different document with different approval — not a negative invoice.
    throw new ValidationError(
      'This application is less than what has already been applied for. ' +
        'Check the percentage, or raise a credit rather than a negative invoice.',
    );
  }

  const retentionAmount = percentOf(grossThisPeriod, input.retentionPercent);
  if (retentionAmount > grossThisPeriod) {
    throw new ValidationError('Retention cannot exceed the amount being applied for');
  }

  const netValue = grossThisPeriod - retentionAmount;
  const vatAmount = percentOf(netValue, input.vatPercent);
  const totalDue = netValue + vatAmount;

  return {
    grossThisPeriod: fromFils(grossThisPeriod),
    retentionAmount: fromFils(retentionAmount),
    netValue: fromFils(netValue),
    vatAmount: fromFils(vatAmount),
    totalDue: fromFils(totalDue),
  };
}

/** Adds decimal strings without ever touching a float. */
export function sumDecimals(values: (string | number | null | undefined)[]): string {
  let total = 0;
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    total += toFils(value);
  }
  return fromFils(total);
}

export function subtractDecimals(a: string | number, b: string | number): string {
  return fromFils(toFils(a) - toFils(b));
}

/** For display and comparison only. Never write the result back to a column. */
export function decimalToNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  return toFils(value) / SCALE;
}

export interface CreditInput {
  /** The gross being taken back off an application. */
  grossAmount: string;
  /** The rate that was withheld on the invoice being credited. */
  retentionPercent: string;
  /** The rate that was charged on it. */
  vatPercent: string;
}

export interface CreditLines {
  grossAmount: string;
  retentionAmount: string;
  netValue: string;
  vatAmount: string;
  totalCredited: string;
}

/**
 * A credit note, computed exactly as the application it reverses.
 *
 *   gross being credited
 *   less the retention that was withheld on it   = net
 *   plus VAT on the net                          = total credited
 *
 * The retention line is the one people get wrong. Crediting an
 * over-certification of 10,000 does not put 10,000 back on the client's
 * account: 500 of it was never billed to them, it was withheld. Returning the
 * net while quietly keeping the retention would leave the company reporting
 * money it is no longer entitled to hold, and that error compounds every time
 * a figure is corrected.
 *
 * The rates come from the INVOICE being credited, never from today's contract
 * rules. A retention percentage renegotiated next year must not change what
 * was withheld last year.
 */
export function calculateCredit(input: CreditInput): CreditLines {
  const gross = toFils(input.grossAmount);

  if (gross <= 0) {
    throw new ValidationError('A credit must be more than zero');
  }

  const retentionAmount = percentOf(gross, input.retentionPercent);
  if (retentionAmount > gross) {
    throw new ValidationError('Retention cannot exceed the amount being credited');
  }

  const netValue = gross - retentionAmount;
  const vatAmount = percentOf(netValue, input.vatPercent);

  return {
    grossAmount: fromFils(gross),
    retentionAmount: fromFils(retentionAmount),
    netValue: fromFils(netValue),
    vatAmount: fromFils(vatAmount),
    totalCredited: fromFils(netValue + vatAmount),
  };
}

export interface RetentionReleaseInput {
  /** How much retention is coming back. */
  amount: string;
  vatPercent: string;
}

export interface RetentionReleaseLines {
  retentionReleased: string;
  netValue: string;
  vatAmount: string;
  totalDue: string;
}

/**
 * Retention coming back at a contractual milestone.
 *
 * There is no gross and no percentage of completion here, which is the whole
 * reason a release is not just another application: no new work has been done.
 * The money was earned when the work was done and has been sitting with the
 * client ever since. VAT applies, because the release is an invoice like any
 * other.
 */
export function calculateRetentionRelease(
  input: RetentionReleaseInput,
): RetentionReleaseLines {
  const amount = toFils(input.amount);
  if (amount <= 0) throw new ValidationError('A retention release must be more than zero');

  const vatAmount = percentOf(amount, input.vatPercent);

  return {
    retentionReleased: fromFils(amount),
    netValue: fromFils(amount),
    vatAmount: fromFils(vatAmount),
    totalDue: fromFils(amount + vatAmount),
  };
}
