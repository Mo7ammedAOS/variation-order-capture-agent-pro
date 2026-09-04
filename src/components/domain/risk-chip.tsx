import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import type { RiskLevel } from '@prisma/client';
import { Badge } from '@/components/ui/badge';
import { humanise } from '@/lib/labels';
import { cn } from '@/lib/utils';

const CONFIG = {
  green: { variant: 'riskGreen' as const, Icon: CheckCircle2, label: 'Low' },
  amber: { variant: 'riskAmber' as const, Icon: Clock, label: 'Warning' },
  red: { variant: 'riskRed' as const, Icon: AlertTriangle, label: 'Critical' },
};

/**
 * The RAG chip. Carries an icon as well as a colour, so it still reads for the
 * ~8% of men with a colour vision deficiency — on a site product that is a lot
 * of the actual users, and the whole point of the chip is to be noticed.
 */
export function RiskChip({
  level,
  label,
  className,
  /**
   * The deadline has passed.
   *
   * The ONLY thing in this product that moves continuously. A breached notice
   * period is the one state where doing nothing costs real money, so it is the
   * one state allowed to keep asking for attention — slowly, at 2.4s, because
   * something urgent is read once and filtered out while something quiet at
   * the edge of vision keeps being noticed.
   *
   * If a second looping animation is ever added anywhere in this app, this one
   * stops working. That is the whole reason there is only one.
   */
  breached = false,
}: {
  level: RiskLevel;
  label?: string;
  className?: string;
  breached?: boolean;
}) {
  const { variant, Icon, label: fallback } = CONFIG[level];
  return (
    <Badge
      variant={variant}
      className={cn(
        'transition-colors duration-200',
        breached && level === 'red' && 'motion-breach',
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {label ?? fallback}
    </Badge>
  );
}

export function StatusChip({ status }: { status: string }) {
  // No `capitalize` class: humanise() already decided the casing, and the class
  // would title-case the acronyms it deliberately left alone — which is how
  // "QS pricing" was rendering as "Qs Pricing" on the register.
  return <Badge variant="secondary">{humanise(status)}</Badge>;
}
