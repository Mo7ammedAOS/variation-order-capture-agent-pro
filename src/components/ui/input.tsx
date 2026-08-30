import * as React from 'react';
import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-xl border border-input bg-card px-3.5 py-2 text-base',
        'transition-shadow placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:border-primary/40 focus-visible:ring-4',
        'focus-visible:ring-primary/12 disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-28 w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-base',
        'transition-shadow placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:border-primary/40 focus-visible:ring-4',
        'focus-visible:ring-primary/12 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-xl border border-input bg-card px-3.5 py-2 text-base',
        'transition-shadow placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:border-primary/40 focus-visible:ring-4',
        'focus-visible:ring-primary/12 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = 'Select';

const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('text-sm font-semibold leading-none tracking-[-0.01em] text-foreground', className)}
      {...props}
    />
  ),
);
Label.displayName = 'Label';

export { Input, Textarea, Select, Label };
