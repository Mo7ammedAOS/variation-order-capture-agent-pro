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
 */
const LINKS = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/my-tasks', label: 'My Tasks', icon: ListChecks },
  { href: '/variations', label: 'Potential Changes', icon: FileWarning },
  { href: '/bottlenecks', label: 'Held Up', icon: AlertOctagon },
  { href: '/inbox', label: 'Capture Inbox', icon: Inbox },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/settings/company', label: 'Company', icon: Building2 },
  { href: '/settings/users', label: 'Users', icon: Settings },
  { href: '/settings/permissions', label: 'Permissions', icon: ShieldCheck },
];

export function SidebarNav() {
  const pathname = usePathname();

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
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
            )}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Bottom bar on phones. The five things someone on site actually opens. */
export function MobileNav() {
  const pathname = usePathname();
  const items = LINKS.slice(0, 5);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/70 bg-white/85 backdrop-blur-md pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
    >
      <ul className="grid grid-cols-5">
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
