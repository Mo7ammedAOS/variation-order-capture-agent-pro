import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Status chips.
 *
 * The `risk` variants are reserved for the RAG scale and nothing else. A red
 * chip in this product means a commercial deadline is at risk; using it to
 * decorate an unrelated label teaches people to ignore the one that matters.
 *
 * All of them carry a 1px inner ring of their own colour rather than a border.
 * Over frosted glass a flat tinted pill has no edge and dissolves into the
 * surface; the ring gives it one without adding to its box, so a chip changing
 * state never nudges the text beside it.
 *
 * Note the brand does NOT appear here. Chips are for status, and the brand
 * means "press this" — the two must not be confused on a register where both
 * a risk chip and a primary action sit in the same row.
 */
const badgeVariants = cva(
  [
    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full',
    'px-2.5 py-1 text-xs font-semibold tracking-[-0.005em]',
    'transition-colors duration-200',
  ].join(' '),
  {
    variants: {
      variant: {
        default: 'bg-secondary text-secondary-foreground shadow-[inset_0_0_0_1px_var(--border)]',
        secondary: 'bg-secondary text-secondary-foreground shadow-[inset_0_0_0_1px_var(--border)]',
        outline: 'text-foreground shadow-[inset_0_0_0_1px_var(--border)]',
        riskGreen:
          'bg-risk-green-bg text-risk-green shadow-[inset_0_0_0_1px_oklch(from_var(--risk-green)_l_c_h/0.30)]',
        riskAmber:
          'bg-risk-amber-bg text-risk-amber shadow-[inset_0_0_0_1px_oklch(from_var(--risk-amber)_l_c_h/0.30)]',
        riskRed:
          'bg-risk-red-bg text-risk-red shadow-[inset_0_0_0_1px_oklch(from_var(--risk-red)_l_c_h/0.30)]',
        riskNeutral:
          'bg-risk-neutral-bg text-risk-neutral shadow-[inset_0_0_0_1px_var(--border)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
