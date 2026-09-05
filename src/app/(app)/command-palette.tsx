'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertOctagon, Building2, FileText, FileWarning, FolderKanban, Inbox,
  LayoutDashboard, ListChecks, Loader2, Plus, Search, Settings, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The command palette.
 *
 * Cmd+K, type, Enter. It exists because the two things people actually do in
 * this app are "open that project" and "find PC-DXB-001-0007", and both
 * currently cost a page load, a scan and a click. On a register that will run
 * to hundreds of changes per project, jumping straight to a PC number is the
 * difference between the app being usable from a phone in a corridor and not.
 *
 * Three things it deliberately does not do:
 *
 *   It does not search until you have typed two characters. One character
 *   matches most of the register and returns noise that has to be read before
 *   it can be dismissed.
 *
 *   It does not cache results between openings. The register changes underneath
 *   you all day, and a stale hit that opens a change someone else already
 *   closed is worse than a slightly slower search.
 *
 *   It does not index anything client-side. Results come from /api/command,
 *   which scopes to the caller. A palette holding every project in memory would
 *   be a cross-project leak wearing the costume of a feature.
 */

interface CommandResult {
  projects: { id: string; code: string; name: string }[];
  changes: {
    id: string;
    pcNumber: string;
    title: string;
    projectCode: string;
    riskLevel: string | null;
  }[];
}

interface Item {
  id: string;
  label: string;
  hint?: string;
  href: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  group: string;
  tone?: string | null;
}

/**
 * Where the palette can take you.
 *
 * Built from the links the shell decided this person may see, rather than from
 * a second list beside the sidebar. Two lists of destinations is how a page
 * that was removed from the menu stays one keystroke away — and a search box
 * that offers a door it knows is locked is worse than one that never mentions
 * it.
 *
 * Reporting a change is offered to everybody, because everybody may.
 */
const PALETTE_ICONS: Record<string, Item['icon']> = {
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

const REPORT_ACTION: Item = {
  id: 'act-report',
  label: 'Report a change',
  hint: 'Capture a new potential change',
  href: '/report-change',
  icon: Plus,
  group: 'Do',
};

export function CommandPalette({ links }: { links: { href: string; label: string }[] }) {
  // Memoised on the links themselves: rebuilt on every render it would be a
  // new array each time, which quietly defeats the memo below that filters it.
  const NAVIGATION: Item[] = useMemo(
    () => [
      ...links.map((link) => ({
        id: `nav-${link.href}`,
        label: link.label,
        href: link.href,
        icon: PALETTE_ICONS[link.href] ?? LayoutDashboard,
        group: 'Go to',
      })),
      REPORT_ACTION,
    ],
    [links],
  );

  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CommandResult>({ projects: [], changes: [] });
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setResults({ projects: [], changes: [] });
    setActive(0);
  }, []);

  // Cmd+K / Ctrl+K anywhere, except while someone is typing into a field —
  // intercepting it inside a textarea would swallow a real keystroke.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;

      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;
      if (typing && !open) return;

      event.preventDefault();
      setOpen((value) => !value);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced, and abortable: typing quickly fires several searches and the
  // last one must win. Without the abort, a slow early response can land after
  // a fast later one and replace correct results with stale ones.
  useEffect(() => {
    if (!open) return;

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults({ projects: [], changes: [] });
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/command?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        setResults((await response.json()) as CommandResult);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setResults({ projects: [], changes: [] });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, open]);

  const items = useMemo<Item[]>(() => {
    const needle = query.trim().toLowerCase();

    const navigation = needle
      ? NAVIGATION.filter((item) => item.label.toLowerCase().includes(needle))
      : NAVIGATION;

    const changes: Item[] = results.changes.map((change) => ({
      id: `pc-${change.id}`,
      label: `${change.pcNumber} — ${change.title}`,
      hint: change.projectCode,
      href: `/variations/${change.id}`,
      icon: FileWarning,
      group: 'Potential changes',
      tone: change.riskLevel,
    }));

    const projects: Item[] = results.projects.map((project) => ({
      id: `proj-${project.id}`,
      label: `${project.code} — ${project.name}`,
      hint: 'Open project',
      href: `/projects/${project.id}`,
      icon: FolderKanban,
      group: 'Projects',
    }));

    const reports: Item[] = results.projects.map((project) => ({
      id: `rep-${project.id}`,
      label: `${project.code} variation register report`,
      hint: 'Print or save as PDF',
      href: `/projects/${project.id}/report`,
      icon: FileText,
      group: 'Reports',
    }));

    return [...changes, ...projects, ...reports, ...navigation];
  }, [results, query, NAVIGATION]);

  useEffect(() => {
    setActive(0);
  }, [items.length]);

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((value) => (items.length === 0 ? 0 : (value + 1) % items.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((value) => (items.length === 0 ? 0 : (value - 1 + items.length) % items.length));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = items[active];
      if (item) {
        close();
        router.push(item.href);
      }
    }
  }

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  let lastGroup = '';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 pt-[12vh] print:hidden"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className={cn(
          'w-full max-w-xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl',
          // Motion is feedback, not decoration: a 120ms rise tells you the
          // panel arrived over the page rather than replacing it. Behind
          // motion-safe, so it does not fire for anyone who asked the OS for
          // reduced motion.
          'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150',
        )}
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search a PC number, a project, or jump to a page"
            aria-label="Search"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {loading ? (
            <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
              esc
            </kbd>
          )}
        </div>

        <ul ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {items.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-muted-foreground">
              {query.trim().length < 2
                ? 'Type at least two characters to search changes and projects.'
                : 'Nothing matches. Changes on projects you are not assigned to will not appear here.'}
            </li>
          ) : (
            items.map((item, index) => {
              const showGroup = item.group !== lastGroup;
              lastGroup = item.group;
              const Icon = item.icon;

              return (
                <li key={item.id}>
                  {showGroup ? (
                    <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {item.group}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    data-active={index === active}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => {
                      close();
                      router.push(item.href);
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-sm transition-colors',
                      index === active ? 'bg-accent' : 'hover:bg-accent/60',
                    )}
                  >
                    <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.tone ? (
                      <span
                        aria-hidden
                        className={cn(
                          'size-2 shrink-0 rounded-full',
                          item.tone === 'red' && 'bg-risk-red',
                          item.tone === 'amber' && 'bg-risk-amber',
                          item.tone === 'green' && 'bg-risk-green',
                        )}
                      />
                    ) : null}
                    {item.hint ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{item.hint}</span>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
