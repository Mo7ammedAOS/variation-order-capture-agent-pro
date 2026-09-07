import Link from 'next/link';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Report a change. THE most important control in the product, and now the only
 * one of its kind on screen.
 *
 * ── One, not three ────────────────────────────────────────────────────────
 * This action had grown to three separate controls: a labelled button in the
 * top bar above `xl`, a floating circle bottom-right below `xl`, and — after
 * the project switcher gained a create button — a third pill at the bottom
 * centre. Three ways to do one thing is not generosity, it is a reader having
 * to work out whether they differ. They did not.
 *
 * ── The shape ─────────────────────────────────────────────────────────────
 * A circle at rest, a labelled pill when you reach for it. The collapsed state
 * is exactly `h-14` tall and `h-14` wide — the icon is 24px inside 16px of
 * padding each side — so it is a true circle rather than a rounded square that
 * nearly is. Hovering (or focusing, which matters for a keyboard) grows the
 * label out of it and the same element becomes the pill.
 *
 * It is a width transition on the LABEL, not on the container. Animating a
 * container to `width: auto` does not transition at all — the browser has no
 * two lengths to interpolate — which is the usual reason this pattern is
 * built with a hard-coded width that then truncates the moment the label is
 * translated. Growing the label's `max-width` lets the container follow along
 * at whatever width the words actually need.
 *
 * The white ring is what keeps it legible over a photograph: a lime disc on a
 * pale travertine floor has almost no edge, and the ring gives it one in both
 * themes without changing the fill.
 */
export function ReportChangeButton({ className }: { className?: string }) {
  return (
    <Link
      href="/report-change"
      aria-label="Report change"
      className={cn(
        'group brand-fill inline-flex h-12 items-center justify-center rounded-full px-3.5',
        /*
          A faded black outline rather than the white one it had, matching the
          rims everywhere else. `ring-inset` keeps it on the disc instead of
          growing the hit area, and the low alpha lets the lime read through it
          rather than being fenced in.
        */
        'shadow-[var(--brand-glow)] ring-1 ring-inset ring-[oklch(0_0_0/0.28)]',
        'transition-[box-shadow,filter,transform] duration-200 ease-[var(--ease-out-quint)]',
        'hover:brightness-[1.06] active:scale-95',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
        'print:hidden',
        className,
      )}
    >
      <Plus aria-hidden className="size-5 shrink-0" />
      <span
        className={cn(
          'ms-0 max-w-0 overflow-hidden whitespace-nowrap text-sm font-bold tracking-[-0.01em]',
          'transition-all duration-300 ease-[var(--ease-out-quint)]',
          'group-hover:ms-2 group-hover:max-w-[9rem]',
          'group-focus-visible:ms-2 group-focus-visible:max-w-[9rem]',
        )}
      >
        Report change
      </span>
    </Link>
  );
}
