import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Card, type PanelTone } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * A single figure on the overview. `tone` is only ever set from a real risk
 * signal — an overdue count, a critical bottleneck — never to make a grid look
 * varied.
 */
export function StatCard({
  label,
  value,
  hint,
  href,
  icon: Icon,
  tone = 'neutral',
  panel = 'plain',
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  icon?: LucideIcon;
  tone?: 'neutral' | 'green' | 'amber' | 'red';
  /**
   * Decorative ground only. `tone` still carries the risk, and these two must
   * never be conflated: a panel is chosen for rhythm, a tone because a
   * commercial deadline is at stake.
   */
  panel?: PanelTone;
}) {
  const toneClass = {
    neutral: 'text-foreground',
    green: 'text-risk-green',
    amber: 'text-risk-amber',
    red: 'text-risk-red',
  }[tone];

  const body = (
    <Card
      tone={panel}
      className={cn(
        'h-full p-5 transition-shadow duration-200',
        href && 'hover:shadow-[var(--panel-shadow-lifted)] focus-within:shadow-[var(--panel-shadow-lifted)]',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold tracking-[-0.01em] text-muted-foreground">{label}</p>
        {Icon ? <Icon aria-hidden className={cn('size-4 shrink-0', toneClass)} /> : null}
      </div>
      <p className={cn('tabular mt-2.5 text-[2rem] font-extrabold leading-none tracking-[-0.035em]', toneClass)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );

  return href ? (
    <Link href={href} className="block rounded-[var(--panel-radius)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20">
      {body}
    </Link>
  ) : (
    body
  );
}
