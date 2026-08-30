'use client';

import { AlertTriangle, LogOut, RefreshCw } from 'lucide-react';

/**
 * What a person sees when a server render fails.
 *
 * The thing being replaced is Next's own fallback: "Application error: a
 * server-side exception has occurred", followed by a digest, on a blank white
 * page, with no way forward. It tells the person nothing they can use and
 * gives them nothing to press. Someone on a site with one bar of signal reads
 * that as "the app is gone".
 *
 * So: say plainly that it is our fault and not theirs, offer the two moves
 * that actually resolve most of these — try again, and sign out — and keep the
 * digest visible but subordinate, because it is the one string that lets us
 * find the failure in the logs.
 *
 * `Sign out` goes through /auth/signed-out rather than the sign-out action:
 * this component renders precisely when the server is unhappy, and that route
 * clears the cookies itself without needing a render to succeed first.
 */
export function ErrorState({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
}) {
  return (
    <div
      className="flex min-h-dvh items-center justify-center px-4 py-10"
      style={{ background: 'var(--mosaic-ground, #f0f0f0)' }}
    >
      <div className="panel w-full max-w-lg bg-card p-7 sm:p-9">
        <span className="flex size-11 items-center justify-center rounded-xl bg-risk-amber-bg text-risk-amber">
          <AlertTriangle aria-hidden className="size-5" />
        </span>

        <h1 className="mt-5 text-xl font-extrabold tracking-[-0.02em]">
          Something went wrong at our end
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          This is a fault in the application, not something you did, and nothing you
          had entered has been lost. Try again first. If it happens twice, sign out
          and back in — that clears a stale session, which is the most common cause.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          {reset ? (
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              <RefreshCw aria-hidden className="size-4" />
              Try again
            </button>
          ) : null}
          <a
            href="/auth/signed-out"
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-transparent px-5 text-sm font-semibold transition-colors hover:bg-secondary"
          >
            <LogOut aria-hidden className="size-4" />
            Sign out and start again
          </a>
        </div>

        {error.digest ? (
          <p className="mt-6 text-xs text-muted-foreground">
            If you need to report it, quote reference{' '}
            <span className="font-mono font-medium">{error.digest}</span>.
          </p>
        ) : null}
      </div>
    </div>
  );
}
