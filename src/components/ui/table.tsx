import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Wide registers scroll inside their own container. The page body must never
 * scroll horizontally — on a phone that turns every column into a hunt.
 *
 * ── Why the rows are not glass ────────────────────────────────────────────
 * The table sits INSIDE one pane. Every `backdrop-filter` costs the compositor
 * a full sample of what is behind it, and a two-hundred-row register of
 * blurred rows drops frames on the mid-range Android phones this is used on.
 * So the pane blurs once, and the rows are ruled lines and hover washes drawn
 * on top of it — which is also how a printed register looks, and this one gets
 * printed.
 */
const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-x-auto">
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  ),
);
Table.displayName = 'Table';

/*
  The header sticks. On a register that runs past the fold, a column of money
  with no heading in sight is a column of numbers nobody can name — and this
  table has fifteen columns, several of which are money.

  It carries its own blur because content scrolls underneath it: without one,
  rows pass through the header as legible text and the whole thing reads as a
  rendering fault rather than a fixed heading.
*/
const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      'sticky top-0 z-10 bg-[var(--glass-strong)] backdrop-blur-lg',
      '[&_tr]:border-b [&_tr]:border-border',
      'print:static print:bg-transparent print:backdrop-blur-none',
      className,
    )}
    {...props}
  />
));
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b border-border transition-colors duration-150',
        'hover:bg-accent/60',
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-11 whitespace-nowrap px-3 text-start align-middle',
      'text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground',
      className,
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn('px-3 py-3 align-middle', className)} {...props} />
));
TableCell.displayName = 'TableCell';

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
