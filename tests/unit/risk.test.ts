import { describe, expect, it } from 'vitest';
import { calculateNoticeCountdown, worstRisk } from '@/lib/risk';

const now = new Date('2026-08-29T08:00:00Z');

describe('notice risk colour', () => {
  it('is green with comfortable time remaining', () => {
    const result = calculateNoticeCountdown('2026-09-30', { now });
    expect(result.riskLevel).toBe('green');
    expect(result.isOverdue).toBe(false);
  });

  it('turns amber inside the threshold', () => {
    expect(calculateNoticeCountdown('2026-09-05', { now }).riskLevel).toBe('amber');
    expect(calculateNoticeCountdown('2026-08-30', { now }).riskLevel).toBe('amber');
  });

  it('turns red on the day it falls due, not the day after', () => {
    const result = calculateNoticeCountdown('2026-08-29', { now });
    expect(result.riskLevel).toBe('red');
    expect(result.isOverdue).toBe(false);
    expect(result.label).toBe('Due today');
  });

  it('is red and overdue once the deadline has passed', () => {
    const result = calculateNoticeCountdown('2026-08-25', { now });
    expect(result.riskLevel).toBe('red');
    expect(result.isOverdue).toBe(true);
    expect(result.label).toBe('4 days overdue');
  });

  it('respects a configured amber threshold', () => {
    expect(calculateNoticeCountdown('2026-09-10', { now }).riskLevel).toBe('green');
    expect(
      calculateNoticeCountdown('2026-09-10', { now, amberThresholdDays: 21 }).riskLevel,
    ).toBe('amber');
  });

  it('is green with no deadline set, and says so', () => {
    const result = calculateNoticeCountdown(null, { now });
    expect(result.daysRemaining).toBeNull();
    expect(result.label).toBe('No deadline set');
  });

  it('singularises one day', () => {
    expect(calculateNoticeCountdown('2026-08-30', { now }).label).toBe('1 day left');
    expect(calculateNoticeCountdown('2026-08-28', { now }).label).toBe('1 day overdue');
  });
});

describe('worstRisk', () => {
  it('surfaces the most severe signal so nothing hides behind a milder one', () => {
    expect(worstRisk('green', 'amber', 'red')).toBe('red');
    expect(worstRisk('green', 'amber')).toBe('amber');
    expect(worstRisk('green', null, undefined)).toBe('green');
    expect(worstRisk()).toBe('green');
  });
});
