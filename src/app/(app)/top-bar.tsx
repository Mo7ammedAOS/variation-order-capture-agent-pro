'use client';

import Link from 'next/link';
import { Bell, Search } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

/**
 * The floating bar above everything.
 *
 * Four things, left to right: who you are, what you are looking for, how the
 * screen should be lit, and what is waiting for you. It is one pill sitting
 * over the photograph rather than a header welded to the top of the page —
 * the gap is what lets the room show through and what makes the chrome read
 * as floating rather than as a band of colour.
 *
 * ── The search pill is the widest thing here ──────────────────────────────
 * Deliberate. On a register that runs to hundreds of changes per project, the
 * two things people actually do are "open that project" and "find
 * PC-DXB-001-0042", and both used to cost a page load, a scan and a click.
 * Giving search the middle third of the chrome is the clearest way to say it
 * is the fast path. It dispatches the same keystroke the palette listens for,
 * so the click path and ⌘K cannot drift apart.
 */

function Avatar({ name }: { name: string }) {
  // Two initials, from the first and last word — "Mohammed Al Rashid" gives
  // MA, not MO. A single initial is ambiguous on a company of thirty.
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
  // A name is user data and can be anything, including empty — this renders on
  // every page, so it must not be the thing that throws.
  const initials = (last ? `${first[0] ?? ''}${last[0] ?? ''}` : first.slice(0, 2) || '?').toUpperCase();

  return (
    <span
      aria-hidden
      className="brand-fill flex size-9 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-extrabold tracking-[0.02em] shadow-[var(--brand-glow)]"
    >
      {initials}
    </span>
  );
}

export function TopBar({
  fullName,
  firstName,
  unread,
}: {
  fullName: string;
  firstName: string;
  unread: number;
}) {
  return (
    <header
      className={cn(
        /*
          No enclosing pane. The bar was one long ribbon with plain buttons
          inside it; it is now just the buttons, each carrying its own glass.
          Fewer surfaces, more room, and the photograph runs unbroken behind
          the whole top of the screen.
        */
        'flex items-center gap-2 print:hidden',
        /*
          No `sticky` here any more, and none needed: the shell is pinned to
          the viewport and the stage scrolls inside itself, so this bar cannot
          be scrolled away from. A sticky rule would be a second mechanism
          solving a problem the layout no longer has.
        */
        /*
          Left edge flush with the stage, not with the window.

          The rail is `position: fixed`, so it takes no space in the flow and
          the bar was running the full width — overhanging the rail and leaving
          the two panels below it starting at a different x than the one above.
          `ms-` is the same 5.25rem the row uses to reserve the rail (4.25rem
          of rail plus 1rem of gap), so bar and stage share one left edge.

          Margin rather than padding: the panel itself has to start there, not
          just its contents. Logical, so it swaps sides under Arabic with the
          rail it is clearing.
        */
        'md:ms-[5.25rem]',
      )}
    >
      {/* Avatar and greeting share one pill: the name needs a surface to be
          legible over a photograph, and the avatar is already a filled disc. */}
      <div className="glass-control flex min-w-0 shrink-0 items-center gap-2.5 rounded-full p-1.5 lg:pe-4">
        <Avatar name={fullName} />
        {/* The greeting is the first casualty of a narrow screen: it is warmth,
            not information, and the avatar already says whose session this is. */}
        <p className="hidden truncate text-sm font-bold tracking-[-0.02em] lg:block">
          Welcome, {firstName}
        </p>
      </div>

      <button
        type="button"
        onClick={() =>
          window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
          )
        }
        className={cn(
          'glass-control flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-full px-5',
          'text-sm text-muted-foreground',
          'transition-all duration-200 ease-[var(--ease-out-quint)]',
          'hover:border-[oklch(from_var(--brand)_l_c_h/0.4)] hover:text-foreground',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
        )}
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <span className="truncate text-start">
          Search a PC number, a project, or a page…
        </span>
        <kbd className="ms-auto hidden shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-semibold sm:block">
          ⌘K
        </kbd>
      </button>

      <ThemeToggle variant="labelled" className="hidden md:inline-flex" />
      <ThemeToggle className="md:hidden" />

      <Link
        href="/notifications"
        aria-label={unread === 0 ? 'Notifications' : `Notifications, ${unread} unread`}
        className={cn(
          'glass-control relative flex size-12 shrink-0 items-center justify-center rounded-full',
          'text-muted-foreground',
          'transition-colors duration-200 hover:text-foreground',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
        )}
      >
        <Bell aria-hidden className="size-[1.05rem]" />
        {unread > 0 ? (
          <span className="absolute -end-0.5 -top-0.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-risk-red px-1 text-[10px] font-bold leading-[1.1rem] text-white shadow-sm">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </Link>
    </header>
  );
}
