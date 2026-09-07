import Link from 'next/link';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Not found' };

/**
 * 404.
 *
 * There was no `not-found.tsx` anywhere, so a mistyped URL — or, far more
 * likely, a bookmark to a variation somebody has since deleted — got the stock
 * Next.js page: unstyled black-on-white Helvetica, no navigation, no branding,
 * nothing to click. On a product deployed under a client's own domain that
 * reads as the whole application having fallen over.
 *
 * The wording is deliberately non-committal about WHY. This same page answers
 * "you typed it wrong", "the change was deleted", and "you cannot see that
 * project" — and the third one matters: `notFound()` is what a permission
 * check throws when it refuses to confirm a record exists. Saying "this change
 * has been deleted" would leak the fact that it exists to somebody who is not
 * allowed to know. Vague, here, is a security property.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="panel w-full max-w-lg p-7 text-center sm:p-9">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-border bg-[var(--glass-soft)] text-muted-foreground">
          <Compass aria-hidden className="size-5" />
        </span>

        <h1 className="page-title mt-5">
          That page is not here
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          The address may be wrong, the record may have been closed, or it may sit on a
          project you are not assigned to. Your dashboard will have the current position.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href="/dashboard">Go to the overview</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/variations">Open the register</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
