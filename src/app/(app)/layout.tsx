import Link from 'next/link';
import { Bell, HardHat, LogOut } from 'lucide-react';
import { requirePageUser } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { countMyUnread } from '@/services/notification.service';
import { SYSTEM_ROLE_LABELS, type Capability } from '@/lib/rbac';
import { hasCapability } from '@/services/permissions.service';
import { Button } from '@/components/ui/button';
import { signOut } from '@/app/(auth)/actions';
import { MobileNav, NAV_LINKS, ReportChangeFab, SidebarNav } from './nav';
import { CommandPalette } from './command-palette';
import { CommandTrigger } from './command-trigger';
import { PageTransition } from '@/components/domain/page-transition';

export const dynamic = 'force-dynamic';


/**
 * The count is written out, not just implied by a dot.
 *
 * "You have something" is not actionable; "you have four things, two of them
 * overdue" is the difference between opening it now and opening it later. The
 * label carries the number too, so it is announced rather than merely seen.
 */
function NotificationBell({ unread, className }: { unread: number; className?: string }) {
  return (
    <Link
      href="/notifications"
      aria-label={unread === 0 ? 'Notifications' : `Notifications, ${unread} unread`}
      className={`relative inline-flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-secondary ${className ?? ''}`}
    >
      <Bell aria-hidden className="size-4" />
      {unread > 0 ? (
        <span className="absolute -end-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-risk-red px-1 text-[10px] font-bold leading-4 text-white">
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </Link>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const [settings, unread, projectRoles] = await Promise.all([
    prisma.companySettings
      .findFirst({ select: { displayCompanyName: true } })
      .catch(() => null),
    // A failure to count must never cost someone the whole application shell.
    countMyUnread(user).catch(() => 0),
    // EVERY project role this person holds, anywhere. The nav is not on a
    // project, so a project manager on one job and nothing on another should
    // still see the menu his job needs. Asked once for the whole shell; the
    // matrix behind the checks below is memoised for the request.
    prisma.projectMember
      .findMany({
        where: { userId: user.id, active: true },
        select: { projectRole: true },
        distinct: ['projectRole'],
      })
      .then((rows) => rows.map((row) => row.projectRole))
      .catch(() => []),
  ]);

  // What this person can actually reach. A menu full of doors that open onto a
  // polite refusal teaches people that most of the app is not for them, and
  // then they stop reading the part that is.
  //
  // The pages refuse on the server too. This is about what is worth showing.
  const links = (
    await Promise.all(
      NAV_LINKS.map(async (link) => {
        if (!link.capability) return link;
        const allowed = await hasCapability(
          user.systemRole,
          projectRoles,
          link.capability as Capability,
        );
        return allowed ? link : null;
      }),
    )
  ).filter((link): link is (typeof NAV_LINKS)[number] => link !== null);

  return (
    <div
      className="flex min-h-dvh flex-col md:flex-row"
      style={{ background: 'var(--mosaic-ground)' }}
    >
      <aside className="hidden w-64 shrink-0 md:flex md:flex-col print:hidden">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <HardHat aria-hidden className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">
              {settings?.displayCompanyName ?? 'VO Capture'}
            </p>
            <p className="truncate text-xs text-muted-foreground">Variation control</p>
          </div>
        </div>

        <div className="flex-1 px-3">
          <CommandTrigger />
          <SidebarNav links={links} />
        </div>

        <div className="p-3">
          <div className="mb-2 flex items-center gap-2 px-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.fullName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {SYSTEM_ROLE_LABELS[user.systemRole]}
              </p>
            </div>
            <NotificationBell unread={unread} className="shrink-0" />
          </div>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">
              <LogOut aria-hidden className="size-4" />
              Sign out
            </Button>
          </form>
        </div>
      </aside>

      <header className="flex items-center justify-between px-4 py-3 md:hidden print:hidden">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <HardHat aria-hidden className="size-4" />
          </span>
          <span className="truncate text-sm font-semibold">
            {settings?.displayCompanyName ?? 'VO Capture'}
          </span>
        </Link>
        <div className="flex items-center gap-1">
          <NotificationBell unread={unread} />
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="icon" aria-label="Sign out">
              <LogOut aria-hidden className="size-4" />
            </Button>
          </form>
        </div>
      </header>

      {/* Bottom padding clears the mobile nav bar and the capture button. */}
      {/* Printing drops the padding and the bottom clearance: the nav is hidden on
          paper, so the space it reserved is a blank strip at the foot of a page. */}
      <main className="min-w-0 flex-1 px-4 py-6 pb-36 md:px-8 md:py-8 md:pb-12 print:p-0">
        {/*
          `min-w-0` is load-bearing. A flex item defaults to min-width:auto, so
          without it this grows to the width of its widest child — the fifteen
          column register — and the whole PAGE scrolls sideways instead of the
          table scrolling inside its own container. The sidebar then slides off
          screen, which is the visible symptom of a rule about a table.
        */}
        <PageTransition>{children}</PageTransition>
      </main>

      <MobileNav />
      <ReportChangeFab />
      <CommandPalette links={links} />
    </div>
  );
}
