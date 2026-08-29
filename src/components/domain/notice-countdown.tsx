import { CalendarClock } from 'lucide-react';
import { calculateNoticeCountdown } from '@/lib/risk';
import { formatDate } from '@/lib/dates';
import { RiskChip } from '@/components/domain/risk-chip';

/**
 * The notice clock, as a person reads it: the date, then how long is left, then
 * the colour. Overdue is stated in words as well as colour — "4 days overdue"
 * is not something anyone should have to infer from a shade of red.
 */
export function NoticeCountdown({
  noticeDueDate,
  amberThresholdDays = 7,
  compact = false,
}: {
  noticeDueDate: Date | string | null;
  amberThresholdDays?: number;
  compact?: boolean;
}) {
  const countdown = calculateNoticeCountdown(noticeDueDate, { amberThresholdDays });

  if (compact) {
    return <RiskChip level={countdown.riskLevel} label={countdown.label} />;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <CalendarClock aria-hidden className="size-4 text-muted-foreground" />
      <span className="tabular text-sm font-medium">{formatDate(noticeDueDate)}</span>
      <RiskChip level={countdown.riskLevel} label={countdown.label} />
    </div>
  );
}
