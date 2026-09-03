import { describe, expect, it } from 'vitest';
import {
  addWorkingDays,
  calculateNoticeDueDate,
  daysSince,
  daysUntil,
  formatDate,
  formatInstant,
  isWorkingDay,
} from '@/lib/dates';

describe('notice deadline', () => {
  it('is event date plus the contract notice period, in calendar days', () => {
    const due = calculateNoticeDueDate('2026-08-01', 28);
    expect(due.toISOString().slice(0, 10)).toBe('2026-08-29');
  });

  it('handles a zero-day period', () => {
    const due = calculateNoticeDueDate('2026-08-01', 0);
    expect(due.toISOString().slice(0, 10)).toBe('2026-08-01');
  });

  it('crosses month and year boundaries', () => {
    expect(calculateNoticeDueDate('2026-12-20', 21).toISOString().slice(0, 10)).toBe('2027-01-10');
  });

  it('rejects a negative or fractional period rather than silently rounding', () => {
    expect(() => calculateNoticeDueDate('2026-08-01', -1)).toThrow();
    expect(() => calculateNoticeDueDate('2026-08-01', 2.5)).toThrow();
  });

  it('rejects an invalid event date', () => {
    expect(() => calculateNoticeDueDate('not-a-date', 28)).toThrow();
  });
});

describe('date display', () => {
  it('never renders an ambiguous DD/MM string', () => {
    const rendered = formatDate('2026-08-09');
    expect(rendered).toBe('09 Aug 2026');
    expect(rendered).not.toMatch(/\d{2}\/\d{2}/);
  });

  it('renders an em dash for a missing date rather than "Invalid Date"', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('rubbish')).toBe('—');
  });
});

describe('countdowns', () => {
  const now = new Date('2026-08-29T08:00:00Z');

  it('counts days remaining and goes negative once overdue', () => {
    expect(daysUntil('2026-09-05', now)).toBe(7);
    expect(daysUntil('2026-08-29', now)).toBe(0);
    expect(daysUntil('2026-08-25', now)).toBe(-4);
  });

  it('counts days elapsed', () => {
    expect(daysSince('2026-08-22', now)).toBe(7);
  });

  it('returns null when there is no deadline', () => {
    expect(daysUntil(null, now)).toBeNull();
  });
});

describe('working days', () => {
  it('honours a Monday-Friday workweek', () => {
    // 2026-08-28 is a Friday.
    expect(addWorkingDays('2026-08-28', 1, 1, 5).toISOString().slice(0, 10)).toBe('2026-08-31');
  });

  it('supports a wrapping workweek such as Saturday-Thursday', () => {
    // Friday is the only non-working day when the week runs 6..4.
    expect(isWorkingDay(new Date('2026-08-28T00:00:00Z'), 6, 4)).toBe(false);
    expect(isWorkingDay(new Date('2026-08-29T00:00:00Z'), 6, 4)).toBe(true);
  });
});

describe('a timestamp shown as a date', () => {
  // The bug: a variation filed at 01:00 Dubai on 4 September displayed as
  // 3 September. `formatDate` renders in UTC, which is correct for a stored
  // `date` column and wrong for an instant — at UTC+4 every moment between
  // midnight and 04:00 belongs to the previous day in UTC. It is only ever
  // out by one, only ever in the small hours, and it always looks like a
  // plausible date, which is why it survived until somebody filed after
  // midnight.
  const justAfterMidnightInDubai = new Date('2026-09-03T21:00:00.000Z');

  it('reads as the local day, not the UTC one', () => {
    expect(formatInstant(justAfterMidnightInDubai)).toBe('04 Sep 2026');
  });

  it('is what formatDate got wrong', () => {
    expect(formatDate(justAfterMidnightInDubai)).toBe('03 Sep 2026');
  });

  it('still agrees with formatDate in the middle of the day', () => {
    const midday = new Date('2026-09-04T09:00:00.000Z');
    expect(formatInstant(midday)).toBe(formatDate(midday));
  });

  it('leaves a stored calendar date to formatDate', () => {
    // A `@db.Date` column comes back as UTC midnight and has no zone of its
    // own. Running it through the local clock would push it a day BACKWARDS,
    // which is the same bug pointing the other way.
    expect(formatDate('2026-09-04')).toBe('04 Sep 2026');
  });
});
