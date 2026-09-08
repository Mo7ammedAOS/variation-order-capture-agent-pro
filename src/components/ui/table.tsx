import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * ═══ THE REGISTER ════════════════════════════════════════════════════════
 *
 * A bounded scroll box, not a table that runs off the page.
 *
 * ── Why the height is capped ──────────────────────────────────────────────
 * This is the change everything else here depends on. The wrapper used to be
 * `overflow-x-auto` with no height, which had two consequences that both look
 * like separate bugs and are really one:
 *
 *   1. The horizontal scrollbar sat at the BOTTOM OF THE TABLE. On a register
 *      of two hundred rows you had to scroll to the end of the data before you
 *      could slide sideways, then scroll back up to read what you had found.
 *
 *   2. `position: sticky` on the header could never engage. Sticky resolves
 *      against the nearest scrolling ancestor, and a container with no height
 *      constraint never scrolls vertically — so there was nothing to stick to.
 *      That is why the sticky header was removed earlier as inert.
 *
 * Capping the height fixes both at once: the box now scrolls in both axes, so
 * the horizontal bar is pinned to the bottom of what you can SEE, and the
 * header has a scroll container to stick to.
 *
 * `min(70vh, 42rem)` — tall enough that short registers never scroll at all,
 * short enough that the bar is always on screen on a laptop.
 */
const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="table-scroller relative max-h-[min(70vh,42rem)] overflow-auto rounded-2xl">
      <table
        ref={ref}
        /*
          `border-separate` with zero spacing, not `border-collapse`. A
          collapsed table shares borders between cells, and a shared border
          belongs to neither — so it does not travel with a `position: sticky`
          header and the heading row loses its underline the moment it lifts.
          Separate borders stay attached to the cell that drew them.
        */
        className={cn('w-full caption-bottom border-separate border-spacing-0 text-sm', className)}
        {...props}
      />
    </div>
  ),
);
Table.displayName = 'Table';

/**
 * The header sticks, and it is opaque enough to be sat behind.
 *
 * Rows pass underneath it, so a translucent heading would show the data
 * sliding through the column names — which reads as a rendering fault rather
 * than as a fixed header.
 */
const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      'sticky top-0 z-20 [&_th]:bg-[var(--table-head)] [&_th]:backdrop-blur-xl',
      'print:static [&_th]:print:bg-transparent',
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
  <tbody ref={ref} className={cn('[&_tr:last-child_td]:border-b-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

/**
 * A row is a band, not a line of text.
 *
 * The hover wash covers the whole row rather than a cell, because on a
 * fifteen-column register the thing a person is tracking is the ROW — which
 * change, which user — and losing your place halfway across is the single most
 * common complaint about a wide table.
 */
const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'group/row transition-colors duration-150',
        '[&:hover_td]:bg-[oklch(from_var(--foreground)_l_c_h/0.04)]',
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
      'h-12 whitespace-nowrap border-b border-border px-4 text-start align-middle',
      'text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground',
      'first:ps-5 last:pe-5',
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
  <td
    ref={ref}
    className={cn(
      'border-b border-border/50 px-4 py-3.5 align-middle transition-colors duration-150',
      'first:ps-5 last:pe-5',
      className,
    )}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

/**
 * The actions at the end of a row.
 *
 * ── Why icons, in a row ───────────────────────────────────────────────────
 * These were four labelled buttons stacked vertically — "Add WhatsApp
 * number", "Password", "Deactivate", "Delete" — which made every row four
 * lines tall and turned a seven-person table into a page of scrolling. The
 * labels were also the widest thing in the register, so the column they
 * created pushed everything else off screen.
 *
 * Icons in one line, each with a `title` and an `aria-label`, so the row is a
 * row again. Nothing is hidden: they are all visible at all times, which is
 * the difference between this and a "⋯" menu that costs a click to find out
 * what is even available.
 */
const TableActions = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center justify-end gap-1', className)} {...props} />
  ),
);
TableActions.displayName = 'TableActions';

export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableActions,
};
