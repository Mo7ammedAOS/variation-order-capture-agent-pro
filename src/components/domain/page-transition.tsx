'use client';

import { usePathname } from 'next/navigation';

/**
 * The short rise when a route changes.
 *
 * ── Why a key rather than a library ───────────────────────────────────────
 * Changing `key` on a pathname change makes React discard the subtree and
 * mount a new one, which restarts the CSS animation. That is the entire
 * mechanism: no animation library, no exit transition, no state machine, and
 * nothing to keep in sync with the router.
 *
 * The deliberate omission is the EXIT animation. Animating the old page out
 * means holding it on screen after the user has already asked for a different
 * one, and on a phone over site wifi the navigation is the slow part already.
 * Content that arrives 220ms late feels considered; content that leaves 220ms
 * late feels broken.
 *
 * ── Why it is this small ──────────────────────────────────────────────────
 * 8px and 220ms. Enough for the eye to register that the page is new and
 * settle where the content starts; short enough that somebody moving fast
 * between a task list and a change never waits on it. Anything longer is the
 * interface admiring itself in front of a person with a job to do.
 *
 * Reduced motion turns it off in `globals.css`, which is also where the
 * animation lives — this component only decides WHEN it restarts.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="motion-rise">
      {children}
    </div>
  );
}
