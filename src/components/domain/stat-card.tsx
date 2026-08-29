import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
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
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  icon?: LucideIcon;
  tone?: 'neutral' | 'green' | 'amber' | 'red';
}) {
  const toneClass = {
    neutral: 'text-foreground',
    green: 'text-risk-green',
    amber: 'text-risk-amber',
    red: 'text-risk-red',
  }[tone];

  const body = (
    <Card
      className={cn(
        'h-full p-4 transition-shadow',
        href && 'hover:shadow-md focus-within:shadow-md',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon ? <Icon aria-hidden className={cn('size-4 shrink-0', toneClass)} /> : null}
      </div>
      <p className={cn('tabular mt-2 text-3xl font-semibold tracking-tight', toneClass)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );

  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}
