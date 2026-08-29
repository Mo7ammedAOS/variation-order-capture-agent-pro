import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Status chips.
 *
 * The `risk` variants are reserved for the RAG scale and nothing else. A red
 * chip in this product means a commercial deadline is at risk; using it to
 * decorate an unrelated label teaches people to ignore the one that matters.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        riskGreen: 'border-transparent bg-risk-green-bg text-risk-green',
        riskAmber: 'border-transparent bg-risk-amber-bg text-risk-amber',
        riskRed: 'border-transparent bg-risk-red-bg text-risk-red',
        riskNeutral: 'border-transparent bg-risk-neutral-bg text-risk-neutral',
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
