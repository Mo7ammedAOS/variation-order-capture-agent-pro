import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Back and Cancel, as buttons rather than as text links.
 *
 * These used to be small grey links, which on a phone in daylight are hard to
 * see and harder to hit. They now carry the same 44px target as everything
 * else, and they are colour-coded by consequence so the difference is readable
 * before the label is:
 *
 *   Back      neutral outline   — leaves without touching anything
 *   Cancel    amber outline     — abandons work in progress
 *   the primary action          — solid, and always on the right
 *
 * Cancel is deliberately NOT red. Red is for destructive acts against saved
 * data; discarding an unsaved form is recoverable and should not wear the same
 * colour as deleting something real.
 */

export function BackButton({
  href,
  label = 'Back',
  className,
}: {
  href: string;
  label?: string;
  className?: string;
}) {
  return (
    <Button asChild variant="outline" className={cn('w-fit', className)}>
      <Link href={href}>
        <ArrowLeft aria-hidden className="size-4" />
        {label}
      </Link>
    </Button>
  );
}

export function CancelButton({
  href,
  label = 'Cancel',
  className,
}: {
  href: string;
  label?: string;
  className?: string;
}) {
  return (
    <Button
      asChild
      variant="outline"
      className={cn(
        'border-amber-500/40 text-amber-700 hover:bg-amber-50 hover:text-amber-800',
        'dark:text-amber-400 dark:hover:bg-amber-950/40 dark:hover:text-amber-300',
        className,
      )}
    >
      <Link href={href}>{label}</Link>
    </Button>
  );
}
