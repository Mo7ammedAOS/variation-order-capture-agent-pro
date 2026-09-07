'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { usePathname } from 'next/navigation';

/**
 * Makes navigation FEEL fast, which is a different problem from making it fast.
 *
 * ── The bug this fixes ────────────────────────────────────────────────────
 * Every nav item decided whether it was active by comparing its own href to
 * `usePathname()`. That value does not change when you tap — it changes when
 * the new page has been rendered. Every page in this group is `force-dynamic`
 * against a hosted database, so on site wifi that is several hundred
 * milliseconds during which the thing you just pressed looks exactly as it did
 * before, and the thing you are leaving is still lit. People tap twice.
 *
 * So the intended destination is held here the moment it is pressed, and the
 * nav highlights against `pending ?? pathname`. The lime moves under your
 * finger; the page catches up.
 *
 * ── Why a context rather than local state in each nav ─────────────────────
 * Three separate navigations (the rail, the phone bar, the project switcher)
 * and a progress bar all need the same answer. Held locally they would
 * disagree — tapping the rail would not clear a pending state in the phone bar
 * — and the bar would have nothing to read at all.
 */

interface NavProgress {
  /** Where we are going, if we are going somewhere. */
  pending: string | null;
  /** Call on click, before the router does anything. */
  start: (href: string) => void;
  /** The href a nav item should treat as current. */
  activeHref: string;
}

const Ctx = createContext<NavProgress | null>(null);

export function NavProgressProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pending, setPending] = useState<string | null>(null);

  /*
    Arriving clears the intent. Keyed on `pathname` rather than on a router
    event because this is the one signal that is true for every way a
    navigation can end — a click, the command palette, the back button, or a
    redirect that landed somewhere other than where we aimed.
  */
  useEffect(() => {
    setPending(null);
  }, [pathname]);

  /*
    A navigation that never resolves must not leave the interface lit forever.
    Eight seconds is far past any real page and well short of the point where
    somebody assumes the app has hung.
  */
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(null), 8000);
    return () => clearTimeout(timer);
  }, [pending]);

  const start = useCallback(
    (href: string) => {
      // Re-tapping the page you are on is not a navigation, and lighting the
      // bar for it makes the app look like it is working when it is not.
      if (href !== pathname) setPending(href);
    },
    [pathname],
  );

  const value = useMemo<NavProgress>(
    () => ({ pending, start, activeHref: pending ?? pathname }),
    [pending, start, pathname],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNavProgress(): NavProgress {
  const ctx = useContext(Ctx);
  // The nav components render inside the provider. Falling back rather than
  // throwing means a stray usage degrades to "no optimistic highlight" instead
  // of taking down the shell.
  const pathname = usePathname();
  return ctx ?? { pending: null, start: () => {}, activeHref: pathname };
}

/**
 * The bar across the top of the window while a page is on its way.
 *
 * It does NOT report progress, because nothing here knows any: it eases to 90%
 * and waits. A bar that claims to be at 40% of a request it cannot measure is
 * lying, and everyone has learned to read those as decoration. This one only
 * claims "something is happening, and it started when you pressed".
 *
 * `fixed` and 2px, above everything including the palette, so it is never the
 * thing that shifts the layout.
 */
export function NavProgressBar() {
  const { pending } = useNavProgress();

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-0.5 print:hidden"
    >
      <div
        className="h-full origin-left transition-[transform,opacity] ease-[var(--ease-out-quint)]"
        style={{
          background: 'var(--brand-gradient)',
          boxShadow: 'var(--brand-glow)',
          transform: `scaleX(${pending ? 0.9 : 1})`,
          opacity: pending ? 1 : 0,
          transitionDuration: pending ? '2400ms' : '220ms',
        }}
      />
    </div>
  );
}
