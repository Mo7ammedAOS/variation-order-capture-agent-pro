import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Card, type PanelTone } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * A single figure on the overview. `tone` is only ever set from a real risk
 * signal — an overdue count, a critical bottleneck — never to make a grid look
 * varied.
 *
 * ── The icon tile ─────────────────────────────────────────────────────────
 * The icon sits in a tinted tile rather than floating as a bare glyph. On
 * frosted glass a 16px outline icon has almost no visual weight and reads as
 * a smudge; the tile gives it a footprint and, when the card carries a risk
 * tone, lets the risk colour appear twice — once quietly behind the icon and
 * once loudly on the figure — without ever being applied to the whole card.
 *
 * Colouring the whole surface by risk was the alternative and it is wrong: a
 * grid of nine cards, four of them red, is a wall of alarm in which nothing
 * is legible as more urgent than anything else.
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
  const figureClass = {
    neutral: 'text-foreground',
    green: 'text-risk-green',
    amber: 'text-risk-amber',
    red: 'text-risk-red',
  }[tone];

  const tileClass = {
    neutral: 'bg-[var(--glass-soft)] text-muted-foreground border-border',
    green: 'bg-risk-green-bg text-risk-green border-transparent',
    amber: 'bg-risk-amber-bg text-risk-amber border-transparent',
    red: 'bg-risk-red-bg text-risk-red border-transparent',
  }[tone];

  const body = (
    <Card
      tone={panel}
      interactive={Boolean(href)}
      className="flex h-full flex-col p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.8rem] font-semibold leading-snug tracking-[-0.01em] text-muted-foreground">
          {label}
        </p>
        {Icon ? (
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-xl border',
              tileClass,
            )}
          >
            <Icon aria-hidden className="size-4" />
          </span>
        ) : null}
      </div>

      <p
        className={cn(
          'tabular mt-3 text-[2.1rem] font-extrabold leading-none tracking-[-0.045em]',
          figureClass,
        )}
      >
        {value}
      </p>

      {hint ? (
        <p className="mt-auto pt-2 text-xs leading-snug text-muted-foreground">{hint}</p>
      ) : null}
    </Card>
  );

  return href ? (
    <Link
      href={href}
      className="block rounded-[var(--panel-radius)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[oklch(from_var(--brand)_l_c_h/0.25)]"
    >
      {body}
    </Link>
  ) : (
    body
  );
}
