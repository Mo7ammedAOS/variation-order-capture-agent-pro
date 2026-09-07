'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useNavProgress } from './nav-progress';

export interface SwitcherProject {
  id: string;
  code: string;
  name: string;
}

/**
 * The floating bar of jobs along the bottom.
 *
 * ── What it is, and what it deliberately is not ───────────────────────────
 * It is NAVIGATION — each pill opens that project's page. It is not a global
 * project filter. A switcher that silently scoped every other screen would be
 * a new piece of application state with its own persistence, its own effect on
 * every query, and its own way of lying to somebody who forgot which job was
 * selected when they read a total. The registers in this product are
 * deliberately cross-project; a director's overdue figure means nothing if it
 * quietly excludes eleven of their jobs.
 *
 * So: fast access to the jobs you work on, and nothing more. The projects
 * shown are already scoped to the caller on the server.
 *
 * ── Why the codes ─────────────────────────────────────────────────────────
 * The pill shows the project CODE, not the name. "DXB-001" is what people say
 * out loud, write on a drawing and type into search; "Dubai Marina Office
 * Fit-Out Phase 2" is what it is called in the contract and will not fit in a
 * pill. The full name is the accessible name and the tooltip.
 */
export function ProjectSwitcher({ projects }: { projects: SwitcherProject[] }) {
  const { activeHref, start } = useNavProgress();

  /*
    No jobs, no bar. It used to keep a "New project" button alive here so the
    bar always had something in it — but creating a project belongs on the
    Projects page, next to the list of them, not floating over every screen in
    the application. An empty pill hovering over the room is worse than no pill.
  */
  if (projects.length === 0) return null;

  return (
    <div className="hidden justify-center md:flex print:hidden">
      <nav
        aria-label="Projects"
        className="panel glass-chrome flex max-w-full items-center gap-1 rounded-full p-1.5"
      >
        {/*
          Horizontal scroll rather than wrapping. A company with twenty live
          jobs must not get a five-line bar that eats the register it floats
          over — and on a trackpad this scrolls naturally.
        */}
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {projects.map((project) => {
            const href = `/projects/${project.id}`;
            const active = activeHref === href || activeHref.startsWith(`${href}/`);
            return (
              <Link
                key={project.id}
                href={href}
                prefetch
                onClick={() => start(href)}
                title={project.name}
                aria-label={`${project.code} — ${project.name}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-9 shrink-0 items-center rounded-full px-4',
                  'text-sm font-bold tracking-[-0.01em] whitespace-nowrap',
                  'transition-all duration-200 ease-[var(--ease-out-quint)] active:scale-95',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                  active
                    ? 'glass-lens text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {project.code}
              </Link>
            );
          })}
        </div>

      </nav>
    </div>
  );
}
