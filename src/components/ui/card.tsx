import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Card IS the mosaic panel.
 *
 * Changed here rather than page by page, so every screen in the app — and every
 * form not yet written — inherits the design instead of being retrofitted into
 * it one at a time.
 *
 * `tone` swaps only the gradient ground. The five tones are DECORATIVE and mean
 * nothing commercially, which is what keeps them clear of the RAG scale: on
 * this product a red chip means a deadline is at risk, and no surface may
 * borrow that vocabulary for looks.
 */
export type PanelTone = 'plain' | 'notice' | 'connect' | 'work' | 'insight' | 'search';

const TONE_CLASS: Record<PanelTone, string> = {
  plain: '',
  notice: 'panel-notice',
  connect: 'panel-connect',
  work: 'panel-work',
  insight: 'panel-insight',
  search: 'panel-search',
};

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: PanelTone;
  /**
   * The whole card opens something.
   *
   * Adds the hover lift. Set it ONLY when the card is genuinely a link or a
   * button — a card that rises under the cursor and does nothing when clicked
   * is a promise the interface does not keep, and people stop trusting the
   * ones that do work.
   */
  interactive?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, tone = 'plain', interactive = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'panel text-card-foreground',
        TONE_CLASS[tone],
        interactive && 'panel-interactive',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1.5 p-5 sm:p-6', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('font-bold leading-tight tracking-[-0.02em]', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-5 pt-0 sm:px-6 sm:pb-6', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-5 pt-0 sm:px-6 sm:pb-6', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
