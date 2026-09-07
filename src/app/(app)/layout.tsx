import { requirePageUser } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { countMyUnread } from '@/services/notification.service';
import { type Capability } from '@/lib/rbac';
import { hasCapability } from '@/services/permissions.service';
import { scopeProjectsToUser } from '@/services/project-access.service';
import { MobileNav } from './nav';
import { IconRail } from './icon-rail';
import { TopBar } from './top-bar';
import { ProjectSwitcher, type SwitcherProject } from './project-switcher';
import { ReportChangeButton } from './report-change-button';
// Plain data, from a module with no 'use client'. Importing it from a client
// module hands a server component a client-reference proxy instead of the
// array, which builds and typechecks and then 500s every page in production.
import { NAV_LINKS, type NavLink } from './nav-links';
import { CommandPalette } from './command-palette';
import { NavProgressBar, NavProgressProvider } from './nav-progress';
import { PageTransition } from '@/components/domain/page-transition';

export const dynamic = 'force-dynamic';

/**
 * THE SHELL.
 *
 *   ┌─ top bar ────────────────────────────────────────────┐   floating pill
 *   ┌ rail ┐  ┌─ stage ──────────────────────────────────┐     the page lives
 *   │ icons│  │  the page                                │     inside one pane
 *   └──────┘  └──────────────────────────────────────────┘
 *              ┌─ projects ─┐                                 floating pill
 *
 * Four floating surfaces over a photograph of a finished fit-out, with real
 * gaps between them so the room shows through. Nothing is welded to an edge of
 * the window — that gap is the entire difference between "glass panels in a
 * room" and "a website with a background image".
 *
 * ── What was removed, and why ─────────────────────────────────────────────
 * The 256px labelled sidebar, the company name block, the separate sidebar
 * search box, the user-name-and-role block and the labelled sign-out button
 * are all gone. Together they were a quarter of a laptop screen spent on
 * things that never change, in a product whose actual content is a register
 * with more columns than fit. Their jobs moved: navigation to the rail,
 * search into the top bar where it is now the widest control on screen,
 * identity to the avatar, sign-out to the foot of the rail.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();

  const [unread, projectRoles] = await Promise.all([
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

  /*
    The jobs in the bottom bar.

    Scoped through `scopeProjectsToUser`, which is the same gate every other
    project read goes through — the switcher must never become the one
    place a project leaks from. Only the three columns the pills need are
    selected: `listProjects` also joins every member and their user record,
    which is a lot of rows to fetch for a strip of short codes.

    Capped at twelve. Beyond that the bar is a scrolling ribbon nobody reads,
    and the Projects page is the right tool.
  */
  const projects: SwitcherProject[] = await scopeProjectsToUser(user)
    .then((scope) =>
      prisma.project.findMany({
        where: { ...scope, projectStatus: 'active' },
        select: { id: true, projectCode: true, projectName: true },
        orderBy: { projectCode: 'asc' },
        take: 12,
      }),
    )
    .then((rows) =>
      rows.map((row) => ({ id: row.id, code: row.projectCode, name: row.projectName })),
    )
    .catch(() => []);

  const firstName = user.fullName.trim().split(/\s+/)[0] ?? user.fullName;

  return (
    /*
      THE SHELL DOES NOT SCROLL. The stage does.

      `h-dvh` + `overflow-hidden` pins the whole frame to exactly one screen,
      so the top bar, the rail and the project switcher are always where you
      left them and content can never travel up behind the bar. The page inside
      the stage scrolls within its own rounded pane — which is what the glass
      composition implies: panels are objects on a desk, and paper moves inside
      them rather than the desk sliding away.

      `dvh` rather than `vh` because a phone's address bar changes the viewport
      height as you scroll, and `vh` would leave the bottom bar cut off.

      Print undoes all of it: a clipped scroll container prints one screenful
      and silently drops the rest of the register, which is the sort of bug you
      only discover in a meeting.
    */
    <NavProgressProvider>
    <div
      className={[
        'flex h-dvh flex-col gap-3 overflow-hidden p-3 md:gap-4 md:p-4',
        'print:block print:h-auto print:overflow-visible print:p-0',
      ].join(' ')}
    >
      <NavProgressBar />

      <a href="#main" className="skip-link">
        <span className="brand-fill inline-flex items-center rounded-xl px-4 py-2.5 text-sm font-bold shadow-[var(--brand-glow)]">
          Skip to content
        </span>
      </a>

      <TopBar fullName={user.fullName} firstName={firstName} unread={unread} />

      <div className="flex min-h-0 flex-1 gap-3 md:gap-4">
        <IconRail links={links} />

        {/*
          THE STAGE. One pane, and the page renders inside it.

          `min-w-0` is load-bearing. A flex item defaults to min-width:auto, so
          without it this grows to the width of its widest child — the fifteen
          column register — and the whole PAGE scrolls sideways instead of the
          table scrolling inside its own container. The rail then slides off
          screen, which is the visible symptom of a rule about a table.
        */}
        <main
          id="main"
          /* -1 so the skip link can move focus here without making the region
             itself a tab stop for everyone else. */
          tabIndex={-1}
          className={[
            'panel panel-stage min-w-0 flex-1 rounded-[1.75rem] p-4 outline-none sm:p-5 md:p-6',
            /*
              The scroll container. `min-h-0` is what makes it one: a flex item
              defaults to `min-height: auto`, which refuses to shrink below its
              content, so the item would grow past the frame and the PAGE would
              scroll again — exactly the behaviour being removed.

              `overflow-y-auto` also overrides `.panel`'s `overflow: hidden`,
              which would otherwise clip the content with no way to reach it.
            */
            'min-h-0 overflow-y-auto',
            // Clears the floating phone nav and the capture button.
            'pb-32 md:pb-6',
            'print:h-auto print:overflow-visible print:rounded-none print:border-0 print:bg-transparent print:p-0 print:shadow-none',
          ].join(' ')}
        >
          <PageTransition>{children}</PageTransition>
        </main>
      </div>

      {/*
        The bottom row: the jobs you work on, and the one action this product
        exists for, in a single centred group so they can never collide.
      */}
      <div className="flex items-center justify-center gap-3 print:hidden">
        <ProjectSwitcher projects={projects} />
        <ReportChangeButton className="hidden md:inline-flex" />
      </div>

      {/*
        The same button on a phone, where the row above is hidden and the
        bottom edge belongs to the nav bar. Only ever ONE of the two is
        rendered at a given width — this is one control, positioned twice, not
        two controls.
      */}
      <ReportChangeButton className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] start-1/2 z-30 -translate-x-1/2 md:hidden" />

      <MobileNav links={links} />
      <CommandPalette links={links} />
    </div>
    </NavProgressProvider>
  );
}
