import { describe, expect, it } from 'vitest';
import {
  addWorkingDays,
  calculateNoticeDueDate,
  daysSince,
  daysUntil,
  formatDate,
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
