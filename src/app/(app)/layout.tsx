import Link from 'next/link';
import { Bell, LogOut } from 'lucide-react';
import { requirePageUser } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { countMyUnread } from '@/services/notification.service';
import { SYSTEM_ROLE_LABELS, type Capability } from '@/lib/rbac';
import { hasCapability } from '@/services/permissions.service';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { signOut } from '@/app/(auth)/actions';
import { MobileNav, ReportChangeFab, SidebarNav } from './nav';
// Plain data, from a module with no 'use client'. Importing it from './nav'
// hands a server component a client-reference proxy instead of the array,
// which builds and typechecks and then 500s every page in production.
import { NAV_LINKS, type NavLink } from './nav-links';
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
 *
 * The badge is one of only two places outside the RAG scale where red appears,
 * and it is legitimate: an unread count IS a backlog. It does not breathe —
 * that is reserved for a breached notice period.
 */
function NotificationBell({ unread, className }: { unread: number; className?: string }) {
  return (
    <Link
      href="/notifications"
      aria-label={unread === 0 ? 'Notifications' : `Notifications, ${unread} unread`}
      className={`relative inline-flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground ${className ?? ''}`}
    >
      <Bell aria-hidden className="size-[1.05rem]" />
      {unread > 0 ? (
        <span className="absolute -end-0.5 -top-0.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-risk-red px-1 text-[10px] font-bold leading-[1.1rem] text-white shadow-sm">
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * The mark. An SVG rather than the Lucide hard hat, because at 20px inside a
 * gradient tile the icon needs a heavier stroke than the icon set's 2px to
 * survive — and because this is the one glyph in the product that is ours.
 */
function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={`brand-fill flex shrink-0 items-center justify-center rounded-xl shadow-[var(--brand-glow)] ${className ?? ''}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="size-[55%]"
      >
        <path d="M2 18h20" />
        <path d="M4.5 18V9.5a7.5 7.5 0 0 1 15 0V18" />
        <path d="M9.5 3.4A7.5 7.5 0 0 0 8.6 7" />
        <path d="M14.5 3.4a7.5 7.5 0 0 1 .9 3.6" />
      </svg>
    </span>
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
  ).filter((link): link is NavLink => link !== null);

  const companyName = settings?.displayCompanyName ?? 'VO Capture';

  return (
    /*
      No background here any more. The ground is a fixed photographic layer
      painted by `body::before` in globals.css, and every surface below floats
      over it. A background on this element would sit between the two and hide
      the whole design.
    */
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/*
        The rail FLOATS. Insets on all four sides and its own radius, rather
        than a full-height column butted against the edge of the window — the
        gap is what lets the photograph run behind it and makes the glass read
        as a sheet rather than as a differently-coloured region of the page.

        `sticky` with its own scroll: on a laptop the menu must stay put while
        a two-hundred-row register scrolls beside it, and on a short window the
        menu itself has to be reachable.
      */}
      <aside className="hidden p-3 pe-0 md:block print:hidden">
        <div className="panel glass-chrome sticky top-3 flex h-[calc(100dvh-1.5rem)] w-64 flex-col overflow-y-auto">
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 rounded-xl px-4 py-4 transition-colors hover:bg-accent/50"
          >
            <BrandMark className="size-9" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold leading-tight tracking-[-0.02em]">
                {companyName}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                Variation control
              </span>
            </span>
          </Link>

          <div className="flex-1 px-3">
            <CommandTrigger />
            <SidebarNav links={links} />
          </div>

          <div className="p-3">
            <div className="mb-2 flex items-center gap-2 px-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{user.fullName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {SYSTEM_ROLE_LABELS[user.systemRole]}
                </p>
              </div>
              <NotificationBell unread={unread} className="shrink-0" />
            </div>

            <div className="mb-2 flex justify-center">
              <ThemeToggle />
            </div>

            <form action={signOut}>
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="w-full justify-start text-muted-foreground hover:text-foreground"
              >
                <LogOut aria-hidden className="size-4" />
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </aside>

      {/*
        Phone header. Sticky and glass so the company name and the way out stay
        reachable while a register scrolls under them.
      */}
      <header className="glass-chrome sticky top-0 z-40 flex items-center justify-between border-b px-4 py-2.5 md:hidden print:hidden">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
          <BrandMark className="size-8" />
          <span className="truncate text-sm font-bold tracking-[-0.02em]">{companyName}</span>
        </Link>
        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <NotificationBell unread={unread} />
          <form action={signOut}>
            <Button
              type="submit"
              variant="ghost"
              size="iconSm"
              aria-label="Sign out"
              className="text-muted-foreground"
            >
              <LogOut aria-hidden className="size-4" />
            </Button>
          </form>
        </div>
      </header>

      {/* Bottom padding clears the mobile nav bar and the capture button. */}
      {/* Printing drops the padding and the bottom clearance: the nav is hidden on
          paper, so the space it reserved is a blank strip at the foot of a page. */}
      <main className="min-w-0 flex-1 px-4 py-5 pb-36 md:px-6 md:py-6 md:pb-10 print:p-0">
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
