'use client';

import Link from 'next/link';
import {
  AlertOctagon, Building2, FileWarning, FolderKanban, Inbox,
  LayoutDashboard, ListChecks, LogOut, Settings, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { signOut } from '@/app/(auth)/actions';
import { useNavProgress } from './nav-progress';
import type { NavLink } from './nav-links';

const ICONS: Record<string, typeof LayoutDashboard> = {
  '/dashboard': LayoutDashboard,
  '/my-tasks': ListChecks,
  '/variations': FileWarning,
  '/bottlenecks': AlertOctagon,
  '/inbox': Inbox,
  '/projects': FolderKanban,
  '/settings/company': Building2,
  '/settings/users': Settings,
  '/settings/permissions': ShieldCheck,
};

/**
 * The rail. Icons only, floating clear of the window edge.
 *
 * ── Why the labels went ───────────────────────────────────────────────────
 * A 256px column of labelled links was a quarter of a laptop screen spent on
 * nine words that never change, in a product whose real content is a fifteen
 * column register that never has enough width. The rail is 60px and gives the
 * rest back.
 *
 * The cost is real and worth naming: an icon-only nav is slower to learn.
 * That is paid for three ways — every item keeps its `aria-label`, every item
 * shows a text tooltip on hover, and the page it opens states its own name in
 * a heading. Nobody has to guess for longer than a hover.
 *
 * ── The active state ──────────────────────────────────────────────────────
 * A filled brand circle, which is the second and last sanctioned use of that
 * fill after the primary button. Without a label to colour, the shape IS the
 * signal, so it has to be unmistakable.
 */
export function IconRail({ links }: { links: NavLink[] }) {
  const { activeHref, start } = useNavProgress();

  return (
    <nav
      aria-label="Main"
      className={cn(
        /*
          No enclosing pane — see the top bar. Each icon is its own round
          button, and the column is just the gap between them.
        */
        'hidden w-14 flex-col items-center gap-2 md:flex print:hidden',
        /*
          `relative z-30` so the tooltips are not painted behind the stage.

          `.panel` on the stage carries `backdrop-filter`, and a backdrop
          filter CREATES A STACKING CONTEXT. That made the stage an atomic
          layer painting at its own position in the tree — after the rail —
          so the tooltip's own `z-50` was competing inside the rail's context
          and lost to a sibling that outranked the whole rail. Raising the
          rail itself is the fix; raising the tooltip further never could be.
        */
        'relative z-30',
        /*
          Centred, and exactly as tall as its buttons — without leaving the flow.

          `self-center` overrides the flex row's default stretch, so the panel
          ends immediately below sign-out instead of being pulled to the height
          of the stage, and it sits at the vertical middle of the content area.

          This was briefly `position: fixed` with `top: 50%`, which achieved the
          same look but took the rail out of the flow: it then reserved no width
          of its own, so the row needed a hand-maintained `ps-` to stop the
          stage running underneath. That coupling is gone. It works now only
          because the shell is pinned to the viewport and the stage scrolls
          inside itself — before that change, an in-flow rail would have been
          centred against a page metres long.
        */
        'self-center',
        /*
          Deliberately NOT `overflow-y-auto`, which an earlier version had.

          Setting overflow on one axis computes the other to `auto` as well, so
          it would have clipped the hover tooltips — which sit outside the
          panel by design — and the rail would have silently lost its only
          affordance for learning what the icons mean.

          The rail is nine buttons at most: about 520px including padding. It
          only renders from `md`, and a window wide enough for that is in
          practice tall enough for it. If the menu ever grows past that, this
          needs a scroll container that the tooltips can escape.
        */
      )}
    >
      {links.map(({ href, label }) => {
        const Icon = ICONS[href] ?? LayoutDashboard;
        const active = activeHref === href || activeHref.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            prefetch
            onClick={() => start(href)}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group relative flex size-11 items-center justify-center rounded-full',
              'transition-all duration-200 ease-[var(--ease-out-quint)]',
              // The press. On a rail of unlabelled circles this is the only
              // confirmation that the tap landed on the one you meant.
              'active:scale-90',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
              active
                ? 'brand-fill shadow-[var(--brand-glow)]'
                : 'glass-control text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon aria-hidden className="size-[1.15rem]" />

            {/*
              The tooltip is CSS-only and `aria-hidden` — the accessible name
              is already on the link. Building this with a JS tooltip library
              would ship a popper engine to render nine words that never move.
              `pointer-events-none` so it can never sit between the cursor and
              the thing it describes.
            */}
            <span
              aria-hidden
              className={cn(
                'panel glass-chrome pointer-events-none absolute start-[calc(100%+0.6rem)] z-50',
                'whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold',
                /*
                  `text-foreground` explicitly, because this sits INSIDE the
                  link — and an active link is `brand-fill`, which sets
                  `color: var(--brand-ink)`: a near-black green meant to be
                  read on top of lime. Inherited onto a dark tooltip it was
                  dark green on charcoal, and the label for the page you were
                  actually on was the one nobody could read.
                */
                'text-foreground',
                'opacity-0 transition-opacity duration-150',
                'group-hover:opacity-100 group-focus-visible:opacity-100',
              )}
            >
              {label}
            </span>
          </Link>
        );
      })}

      {/* A little more air before sign out, now that there is no rail behind
          the buttons for a divider line to sit on. */}
      <span aria-hidden className="h-2" />

      <form action={signOut}>
        <button
          type="submit"
          aria-label="Sign out"
          title="Sign out"
          className={cn(
            'glass-control flex size-11 items-center justify-center rounded-full',
            'text-muted-foreground transition-colors duration-200',
            'hover:text-foreground',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
          )}
        >
          <LogOut aria-hidden className="size-[1.15rem]" />
        </button>
      </form>
    </nav>
  );
}
