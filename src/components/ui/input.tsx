import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Fields are recesses in the glass, not panes on top of it.
 *
 * A form control sitting over a photograph has a problem an opaque interface
 * never has: at low opacity the entered text competes with whatever is behind
 * it. So a field is DARKER than its surroundings in light mode and lighter in
 * dark mode — `--glass-soft` does both — with its own blur, so what shows
 * through is a wash rather than a picture.
 *
 * The focus state is a 4px brand ring rather than a border change, because a
 * border that thickens on focus shifts every neighbouring element by a pixel.
 * A ring is painted outside the box and moves nothing.
 */
const fieldClass = [
  'w-full rounded-xl border border-input text-base text-foreground',
  'bg-[var(--glass-soft)] backdrop-blur-md',
  'transition-[box-shadow,border-color] duration-200 ease-[var(--ease-out-quint)]',
  'placeholder:text-muted-foreground',
  'focus-visible:outline-none focus-visible:border-[oklch(from_var(--brand)_l_c_h/0.55)]',
  'focus-visible:ring-4 focus-visible:ring-[oklch(from_var(--brand)_l_c_h/0.18)]',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        fieldClass,
        'flex h-11 px-3.5 py-2',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(fieldClass, 'flex min-h-28 px-3.5 py-2.5', className)}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

/*
  The native select keeps the platform's own dropdown — on a phone that is a
  full-height wheel that works in gloves, and no styled listbox we could write
  would beat it. Only the closed state is themed.
*/
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(fieldClass, 'flex h-11 px-3.5 py-2', className)} {...props} />
  ),
);
Select.displayName = 'Select';

const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        'text-sm font-semibold leading-none tracking-[-0.01em] text-foreground',
        className,
      )}
      {...props}
    />
  ),
);
Label.displayName = 'Label';

export { Input, Textarea, Select, Label };
