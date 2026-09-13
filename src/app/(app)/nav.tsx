'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertOctagon, Building2, FileWarning, FolderKanban, LayoutDashboard,
  ListChecks, LogOut, MoreHorizontal, Settings, ShieldCheck, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { signOut } from '@/app/(auth)/actions';
import { useNavProgress } from './nav-progress';
import type { NavLink } from './nav-links';

/*
  `SidebarNav` used to live here and is gone — the 256px labelled column was
  replaced by the icon rail in `icon-rail.tsx`. What remains in this file is
  the PHONE chrome, which is a genuinely different design: a rail of unlabelled
  icons works on a laptop where a hover reveals the name, and does not work on
  a touch screen where there is no hover.
*/

const ICONS: Record<string, typeof LayoutDashboard> = {
  '/dashboard': LayoutDashboard,
  '/my-tasks': ListChecks,
  '/variations': FileWarning,
  '/bottlenecks': AlertOctagon,
  '/projects': FolderKanban,
  '/settings/company': Building2,
  '/settings/users': Settings,
  '/settings/permissions': ShieldCheck,
};

/** How many links get a permanent slot before the rest go behind "More". */
const PRIMARY_SLOTS = 4;

/**
 * Bottom bar on phones.
 *
 * ── The bug this replaces ─────────────────────────────────────────────────
 * It rendered `NAV_LINKS.slice(0, 4)` — the RAW list, hardcoded to four,
 * ignoring the permission-filtered links the shell had already computed. So a
 * company administrator, who may reach nine pages, got exactly the same four
 * on a phone as a site engineer who may reach four: the capture inbox,
 * projects and all three settings screens were simply unreachable on a phone.
 * The desktop rail had them; the phone silently did not.
 *
 * Two things follow, and both are fixed here:
 *
 *   1. This takes the SAME `links` array the rail takes. There is now one
 *      source of truth for what a person may see, and no way for the two
 *      navigations to disagree again.
 *
 *   2. Sign-out is in here. It had ended up living only in the icon rail,
 *      which is `hidden md:flex` — so on a phone there was no way to sign out
 *      at all. On a shared site tablet that is not a nicety.
 *
 * ── Why four plus "More", rather than all of them ─────────────────────────
 * Nine items across a 390px screen is 43px each: below the 44px touch floor
 * this product holds to everywhere else, with labels far too small to read in
 * sunlight. Four keeps the things opened all day one tap away, and everything
 * else is two taps and a readable list.
 *
 * When somebody may see five or fewer, there is no "More" button at all and
 * the bar simply shows all of them — a control that opens an empty sheet is
 * worse than no control.
 *
 * It floats, with insets and a radius, for the same reason the desktop rail
 * does. `env(safe-area-inset-bottom)` is added to the OFFSET rather than to
 * the padding, so the gap under it is even on a notched phone instead of the
 * bar growing a chin.
 */
export function MobileNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  const { activeHref, start } = useNavProgress();
  const [open, setOpen] = useState(false);

  const overflow = links.length > PRIMARY_SLOTS + 1 ? links.slice(PRIMARY_SLOTS) : [];
  const primary = overflow.length > 0 ? links.slice(0, PRIMARY_SLOTS) : links;
  const showMore = overflow.length > 0;

  /*
    Against the OPTIMISTIC path, not the real one — so the lozenge slides to
    the item you tapped immediately, rather than after the server has rendered
    the page. See `nav-progress.tsx`.
  */
  const isActive = useCallback(
    (href: string) => activeHref === href || activeHref.startsWith(`${href}/`),
    [activeHref],
  );

  // The sheet closes on navigation. Without this, tapping a link inside it
  // leaves the sheet covering the page you just asked for.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const close = useCallback(() => setOpen(false), []);
  const columns = primary.length + (showMore ? 1 : 0);

  // Nothing to show. Should not happen — the first four links are open to
  // everybody — but a zero-column grid is an ugly way to find that out.
  if (columns === 0) return null;

  return (
    <>
      {showMore ? (
        <MoreSheet open={open} onClose={close} items={overflow} isActive={isActive} />
      ) : null}

      <nav
        aria-label="Main"
        className={cn(
          'panel glass-chrome fixed inset-x-3 z-40 md:hidden print:hidden',
          'bottom-[calc(0.75rem+env(safe-area-inset-bottom))]',
        )}
      >
        <ul
          className="grid"
          /*
            Inline, because the column count depends on how many pages this
            person may see. A Tailwind class cannot be built from a runtime
            value — `grid-cols-${n}` produces a class that was never compiled —
            and the alternative is a lookup table of nine grid classes kept in
            sync with a number by hand.
          */
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {primary.map(({ href, short }) => {
            const Icon = ICONS[href] ?? LayoutDashboard;
            const active = isActive(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  prefetch
                  onClick={() => start(href)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex flex-col items-center gap-1 px-1 py-2.5',
                    'text-[11px] font-semibold transition-colors duration-200',
                    'active:scale-95',
                    /*
                      Light: `--primary`, the readable olive-lime. NOT `--brand`,
                      which is a fill colour and measures 1.04:1 as text on a
                      light panel.

                      Dark: plain white. Osman's call, 2026-09-08 — `--primary`
                      in dark is a bright lime, and on the black glass of the
                      phone bar a lit-up green word read as a warning rather
                      than as "you are here". White carries the same meaning and
                      claims none of the colour vocabulary: in this product
                      colour on text means risk, and the only thing that should
                      shout on a dark screen is a breached deadline.

                      The active item is still obvious without it — the lozenge
                      sits behind it and the inactive labels are muted grey.
                    */
                    active ? 'text-primary dark:text-white' : 'text-muted-foreground',
                  )}
                >
                  <Lozenge active={active} />
                  <Icon aria-hidden className="relative size-5" />
                  <span className="relative truncate">{short}</span>
                </Link>
              </li>
            );
          })}

          {showMore ? (
            <li>
              <button
                type="button"
                onClick={() => setOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={open}
                className="relative flex w-full flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-semibold text-muted-foreground transition-colors duration-200"
              >
                {/* Lit when you are ON one of the hidden pages, so "More" never
                    looks inert while you are standing inside it. */}
                <Lozenge active={overflow.some((link) => isActive(link.href))} />
                <MoreHorizontal aria-hidden className="relative size-5" />
                <span className="relative truncate">More</span>
              </button>
            </li>
          ) : null}
        </ul>
      </nav>
    </>
  );
}

/**
 * A lozenge behind the icon rather than a coloured label. On a 390px screen
 * the labels are already at the floor of legible size, and colouring one short
 * word is a much weaker signal than putting a shape behind it.
 */
function Lozenge({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute inset-x-[18%] top-1.5 h-8 rounded-full transition-all duration-200 ease-[var(--ease-out-quint)]',
        active ? 'bg-[oklch(from_var(--brand)_l_c_h/0.16)] opacity-100' : 'scale-90 opacity-0',
      )}
    />
  );
}

/**
 * Everything that did not fit, plus the way out.
 *
 * A sheet rather than a dropdown: it rises from the same edge the button sits
 * on, which is where a thumb already is, and it can hold full-width rows with
 * real labels instead of a menu of 11px text.
 */
function MoreSheet({
  open,
  onClose,
  items,
  isActive,
}: {
  open: boolean;
  onClose: () => void;
  items: NavLink[];
  isActive: (href: string) => boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Its own subscription: the sheet is a sibling of the bar, not a child, so
  // it cannot take `start` as a prop without threading it through for nothing.
  const { start } = useNavProgress();

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);

    // Move focus in, so a keyboard or switch user is not left behind the
    // sheet, and stop the page underneath scrolling while it is open.
    panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm md:hidden print:hidden"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="More pages"
        className={cn(
          'panel glass-chrome m-3 mb-[calc(0.75rem+env(safe-area-inset-bottom))] rounded-[1.5rem] p-3',
          'motion-safe:animate-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-200',
        )}
      >
        <div className="flex items-center justify-between px-2 pb-2">
          <p className="text-sm font-bold tracking-[-0.01em]">More</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <ul className="flex flex-col gap-1">
          {items.map(({ href, label }) => {
            const Icon = ICONS[href] ?? LayoutDashboard;
            const active = isActive(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  prefetch
                  onClick={() => start(href)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold',
                    'transition-all duration-200 active:scale-[0.98]',
                    active
                      ? 'brand-fill shadow-[var(--brand-glow)]'
                      : 'text-foreground hover:bg-accent',
                  )}
                >
                  <Icon aria-hidden className="size-[1.15rem] shrink-0" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/*
          Sign out, on a phone, at last. It had ended up only in the desktop
          rail, so there was no way off a shared site tablet at all.
        */}
        <form action={signOut} className="mt-2 border-t border-border pt-2">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <LogOut aria-hidden className="size-[1.15rem] shrink-0" />
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
