'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertOctagon, FileWarning, FolderKanban, LayoutDashboard,
  Building2, Inbox, ListChecks, Plus, Settings, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Navigation is ordered by how a working day starts: what needs me, then what
 * is at risk, then everything else. Directors and PMs open this on a laptop;
 * site engineers open it on a phone in a corridor.
 *
 * ── The first four belong to everybody ────────────────────────────────────
 * Osman's call, 2026-09-05. A site engineer needs what is owed by him, what he
 * reported, and what is stuck. Everything below that is somebody's job and
 * nobody else's, and a menu full of doors that open onto a polite refusal
 * teaches people that half the app is not for them — after which they stop
 * reading the half that is.
 *
 * ── Hiding is not the enforcement ─────────────────────────────────────────
 * Every gated page refuses on the server as well. This decides what is worth
 * showing; it decides nothing about what is allowed, and it must never be the
 * only thing standing between somebody and a page.
 */
export interface NavLink {
  href: string;
  label: string;
  /** Null means everybody. Otherwise the capability that reveals it. */
  capability: string | null;
}

export const NAV_LINKS: NavLink[] = [
  { href: '/dashboard', label: 'Overview', capability: null },
  { href: '/my-tasks', label: 'My Tasks', capability: null },
  { href: '/variations', label: 'Variations', capability: null },
  { href: '/bottlenecks', label: 'Held Up', capability: null },
  // The triage queue for messages the system could not place. It is the
  // administrator's desk, not a shared inbox: it holds other people's
  // half-understood reports, and the answer to most of them is a question
  // somebody has to ask by hand.
  { href: '/inbox', label: 'Capture Inbox', capability: 'capture.triage' },
  { href: '/projects', label: 'Projects', capability: 'project.update' },
  { href: '/settings/company', label: 'Company', capability: 'companySettings.manage' },
  { href: '/settings/users', label: 'Users', capability: 'user.manage' },
  { href: '/settings/permissions', label: 'Permissions', capability: 'user.manage' },
];

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
              'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
              'transition-[background-color,color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
              'hover:translate-x-0.5 active:translate-x-0',
              active
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
            )}
          >
            {/* A rail on the active item rather than a heavier fill. It marks
                where you are without competing with the risk colours, which
                are the only things on this screen allowed to shout. */}
            <span
              aria-hidden
              className={cn(
                'absolute inset-y-1.5 -start-1 w-[3px] rounded-full bg-primary',
                'transition-opacity duration-200',
                active ? 'opacity-100' : 'opacity-0',
              )}
            />
            <Icon
              aria-hidden
              className="size-4 shrink-0 transition-transform duration-200 group-hover:scale-110"
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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/70 bg-white/85 backdrop-blur-md pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
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
                  'flex flex-col items-center gap-1 px-1 py-2 text-[11px] font-medium',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <Icon aria-hidden className="size-5" />
                <span className="truncate">{label.split(' ')[0]}</span>
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
 */
export function ReportChangeFab() {
  return (
    <Link
      href="/report-change"
      aria-label="Report change"
      className={cn(
        'fixed end-4 bottom-20 z-50 flex items-center justify-center gap-2 rounded-full',
        'bg-primary text-sm font-semibold text-primary-foreground shadow-lg',
        'size-14 sm:size-auto sm:px-5 sm:py-3.5',
        'transition-transform hover:scale-105 focus-visible:outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:bottom-6',
        'print:hidden',
      )}
    >
      <Plus aria-hidden className="size-6 sm:size-5" />
      <span className="hidden sm:inline">Report Change</span>
    </Link>
  );
}
