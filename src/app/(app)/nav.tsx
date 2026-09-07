'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertOctagon, FileWarning, FolderKanban, LayoutDashboard,
  Building2, Inbox, ListChecks, Plus, Settings, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAV_LINKS, type NavLink } from './nav-links';

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
 * The active item wears the brand gradient.
 *
 * This is the second and last sanctioned use of that fill — the other is the
 * primary button — and the two are never competing for the same decision,
 * because "where I am" and "what to press" are answered in different parts of
 * the screen. Any third use dilutes both.
 *
 * Everything else is a quiet wash on hover. The nav is furniture: it should be
 * findable without being interesting, because the interesting thing on any of
 * these screens is a deadline.
 */
export function SidebarNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  const LINKS = links.map((link) => ({ ...link, icon: ICONS[link.href] ?? LayoutDashboard }));

  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group relative flex items-center gap-3 rounded-xl px-3 py-2.5',
              'text-sm font-semibold tracking-[-0.01em]',
              'transition-all duration-200 ease-[var(--ease-out-quint)]',
              active
                ? 'brand-fill shadow-[var(--brand-glow)]'
                : 'text-muted-foreground hover:translate-x-0.5 hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon
              aria-hidden
              className={cn(
                'size-[1.05rem] shrink-0 transition-transform duration-200',
                !active && 'group-hover:scale-110',
              )}
            />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Bottom bar on phones. The four things someone on site actually opens.
 *
 * Four, not five: the fifth was the capture inbox, which most people can no
 * longer see at all. A grid that silently becomes four columns wide on some
 * accounts and five on others is a layout that looks broken to whoever has
 * fewer, so the phone bar is now exactly the four everybody has.
 *
 * It floats, with insets and a radius, for the same reason the desktop rail
 * does — a bar welded to the bottom edge of a photograph looks like a bar
 * welded to the bottom edge of a photograph. `env(safe-area-inset-bottom)` is
 * added to the offset rather than to the padding so the gap under it is even
 * on a notched phone instead of the bar growing a chin.
 */
export function MobileNav() {
  const pathname = usePathname();
  const items = NAV_LINKS.slice(0, 4).map((link) => ({
    ...link,
    icon: ICONS[link.href] ?? LayoutDashboard,
  }));

  return (
    <nav
      aria-label="Main"
      className={cn(
        'panel glass-chrome fixed inset-x-3 z-40 md:hidden print:hidden',
        'bottom-[calc(0.75rem+env(safe-area-inset-bottom))]',
      )}
    >
      <ul className="grid grid-cols-4">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex flex-col items-center gap-1 px-1 py-2.5',
                  'text-[11px] font-semibold transition-colors duration-200',
                  active ? 'text-[var(--brand)]' : 'text-muted-foreground',
                )}
              >
                {/*
                  A lozenge behind the icon rather than a coloured label. On a
                  390px screen the labels are already at the floor of legible
                  size, and colouring one of four short words is a much weaker
                  signal than putting a shape behind it.
                */}
                <span
                  aria-hidden
                  className={cn(
                    'absolute inset-x-[22%] top-1.5 h-8 rounded-full transition-all duration-200 ease-[var(--ease-out-quint)]',
                    active
                      ? 'bg-[oklch(from_var(--brand)_l_c_h/0.16)] opacity-100'
                      : 'scale-90 opacity-0',
                  )}
                />
                <Icon aria-hidden className="relative size-5" />
                <span className="relative truncate">{label.split(' ')[0]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The capture button. Deliberately the single most reachable control in the
 * app — the whole product depends on a change being filed in the minute it is
 * noticed, not at the end of the day when the detail has gone.
 *
 * On a phone it is a plain circle. A floating pill wide enough to read is also
 * wide enough to sit on top of the register it floats over, and on a 390px
 * screen it covered a card title and part of a chart. The label returns as
 * soon as there is width to spare for it; below that the icon carries the
 * meaning and `aria-label` carries it for a screen reader.
 *
 * It sits clear of the phone nav bar, which now floats and is taller than the
 * old welded one — hence the bottom offset tracking the same safe-area inset.
 */
export function ReportChangeFab() {
  return (
    <Link
      href="/report-change"
      aria-label="Report change"
      className={cn(
        'brand-fill fixed end-4 z-50 flex items-center justify-center gap-2 rounded-full',
        'bottom-[calc(6rem+env(safe-area-inset-bottom))] md:bottom-6',
        'text-sm font-bold tracking-[-0.01em] shadow-[var(--brand-glow)]',
        'size-14 sm:size-auto sm:px-5 sm:py-3.5',
        'transition-all duration-200 ease-[var(--ease-out-quint)]',
        'hover:scale-105 hover:brightness-[1.06] active:scale-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'focus-visible:ring-offset-[var(--background)]',
        'print:hidden',
      )}
    >
      <Plus aria-hidden className="size-6 sm:size-5" />
      <span className="hidden sm:inline">Report Change</span>
    </Link>
  );
}
