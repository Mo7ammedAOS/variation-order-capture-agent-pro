import type { RiskLevel } from '@prisma/client';
import { daysUntil } from '@/lib/dates';

/**
 * Notice risk, as a colour.
 *
 * Red / Amber / Green here means one thing only: how close the contractual
 * notice deadline is. It is never used decoratively, because on this product a
 * red chip is a commercial warning that someone is expected to act on.
 *
 *   Green   more than `amberThresholdDays` remaining
 *   Amber   inside the threshold, still in time
 *   Red     due today has passed — the deadline is gone
 */

export const DEFAULT_AMBER_THRESHOLD_DAYS = 7;

export interface NoticeCountdown {
  daysRemaining: number | null;
  riskLevel: RiskLevel;
  isOverdue: boolean;
  /** Short human phrasing: "12 days left", "due today", "4 days overdue". */
  label: string;
}

export function calculateNoticeCountdown(
  noticeDueDate: Date | string | null | undefined,
  options: { now?: Date; amberThresholdDays?: number; timeZone?: string } = {},
): NoticeCountdown {
  const { now = new Date(), amberThresholdDays = DEFAULT_AMBER_THRESHOLD_DAYS, timeZone } = options;

  const daysRemaining = daysUntil(noticeDueDate, now, timeZone);

  if (daysRemaining === null) {
    return { daysRemaining: null, riskLevel: 'green', isOverdue: false, label: 'No deadline set' };
  }

  if (daysRemaining < 0) {
    const overdueBy = Math.abs(daysRemaining);
    return {
      daysRemaining,
      riskLevel: 'red',
      isOverdue: true,
      label: `${overdueBy} ${overdueBy === 1 ? 'day' : 'days'} overdue`,
    };
  }

  if (daysRemaining === 0) {
    return { daysRemaining, riskLevel: 'red', isOverdue: false, label: 'Due today' };
  }

  const riskLevel: RiskLevel = daysRemaining <= amberThresholdDays ? 'amber' : 'green';

  return {
    daysRemaining,
    riskLevel,
    isOverdue: false,
    label: `${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} left`,
  };
}

/**
 * The worst of several signals wins. A change can be green on its notice clock
 * and still be red because an action is badly overdue — surfacing the milder
 * colour would hide the problem.
 */
export function worstRisk(...levels: (RiskLevel | null | undefined)[]): RiskLevel {
  const rank: Record<RiskLevel, number> = { green: 0, amber: 1, red: 2 };
  let worst: RiskLevel = 'green';
  for (const level of levels) {
    if (level && rank[level] > rank[worst]) worst = level;
  }
  return worst;
}

export const RISK_LABELS: Record<RiskLevel, string> = {
  green: 'Low',
  amber: 'Warning',
  red: 'Critical',
};
