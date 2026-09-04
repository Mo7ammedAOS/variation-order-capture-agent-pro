import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * ── Sizes ─────────────────────────────────────────────────────────────────
 * Set from the hardest case, which is a site engineer holding a phone in one
 * hand with the other on a ladder. 44px is the platform minimum for a reliable
 * tap and it is the DEFAULT here, not the large option: an interface that is
 * comfortable at a desk and marginal on site is an interface that gets used at
 * a desk. `xs` and `sm` exist for controls inside a dense table, where the row
 * itself is the target and the button is a refinement.
 *
 * ── Press ─────────────────────────────────────────────────────────────────
 * Every button scales to 0.97 while held. On a phone the finger covers the
 * control completely, so the only feedback that a tap registered is the frame
 * moving under it — without this, a slow server looks like a dead button and
 * people tap twice. `transition-all`, not `transition-colors`, so the scale
 * and the shadow are carried too.
 */
const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold tracking-[-0.01em] transition-all duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:transition-transform",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-md active:shadow-sm',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 hover:shadow-md',
        outline:
          'border border-border bg-card/80 backdrop-blur-sm hover:border-primary/35 hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        default: 'h-11 px-5 py-2',
        xs: 'h-8 rounded-lg px-2.5 text-xs [&_svg]:size-3.5',
        sm: 'h-9 rounded-lg px-3.5',
        lg: 'h-12 rounded-xl px-7 text-base',
        xl: 'h-14 rounded-2xl px-9 text-base',
        icon: 'h-11 w-11',
        iconSm: 'h-9 w-9 rounded-lg',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
