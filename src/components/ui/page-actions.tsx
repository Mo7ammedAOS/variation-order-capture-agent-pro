import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Back and Cancel, as buttons rather than as text links.
 *
 * These used to be small grey links, which on a phone in daylight are hard to
 * see and harder to hit. They now carry the same 44px target as everything
 * else, and they are ranked by consequence so the difference is readable
 * before the label is:
 *
 *   Back      ghost              — leaves without touching anything
 *   Cancel    outline, bordered  — abandons work in progress
 *   the primary action           — the brand fill, and always on the end
 *
 * ── Why Cancel is no longer amber ─────────────────────────────────────────
 * It used to be an amber outline, which worked when the product's primary
 * colour was blue. The brand is now amber, so an amber-outlined Cancel sitting
 * next to an amber-filled Submit read as two shades of the same instruction —
 * the exact opposite of what a cancel button is for. Reaching for the RAG
 * amber instead would have been worse: that colour means a contractual
 * deadline is running out, and spending it on "you will lose this draft"
 * devalues every warning chip in the product.
 *
 * So the ranking is now weight, not hue. Ghost, then bordered, then filled.
 * It survives a colour-blind reader and a monochrome print, which the amber
 * version never did.
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
    <Button asChild variant="ghost" className={cn('w-fit text-muted-foreground', className)}>
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
    <Button asChild variant="outline" className={cn('w-fit', className)}>
      <Link href={href}>{label}</Link>
    </Button>
  );
}
