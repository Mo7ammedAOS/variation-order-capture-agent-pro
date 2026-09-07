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
  The header does NOT stick, and that is a correction rather than a decision.

  It was written as `sticky top-0` with its own blur. That could never work:
  the wrapper above sets `overflow-x: auto`, and per spec a non-`visible`
  value on one axis forces the other to `auto` — so the wrapper is a scroll
  container in BOTH axes. `position: sticky` resolves against its nearest
  scrolling ancestor, and this one has no height constraint, so it never
  scrolls vertically and the header had nothing to stick to. The page scrolls;
  the container does not.

  It cost a `backdrop-filter`, a stacking context and a z-index to do nothing
  at all. Making it genuinely stick means either giving the wrapper a fixed
  height (so the table scrolls inside the page rather than with it) or
  abandoning horizontal scroll — both bigger decisions than a header, and
  neither is worth making silently. Shipping the appearance of a feature that
  does nothing is worse than not having it.
*/
const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn('[&_tr]:border-b [&_tr]:border-border', className)}
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
