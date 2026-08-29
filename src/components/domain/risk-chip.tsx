import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import type { RiskLevel } from '@prisma/client';
import { Badge } from '@/components/ui/badge';
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
}: {
  level: RiskLevel;
  label?: string;
  className?: string;
}) {
  const { variant, Icon, label: fallback } = CONFIG[level];
  return (
    <Badge variant={variant} className={cn(className)}>
      <Icon aria-hidden className="size-3.5" />
      {label ?? fallback}
    </Badge>
  );
}

export function StatusChip({ status }: { status: string }) {
  const text = status.replace(/_/g, ' ');
  return (
    <Badge variant="secondary" className="capitalize">
      {text}
    </Badge>
  );
}
