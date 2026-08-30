'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { humanise } from '@/lib/labels';

/**
 * The register peek.
 *
 * Opening a change to answer "what is this one, again?" costs a page load and
 * loses your place in a register you were halfway through scanning. The drawer
 * answers the question beside the row and closes, and the register is still
 * exactly where you left it — scroll position, filters and all.
 *
 * It fetches on open rather than being handed every change up front. Serialising
 * the full register into the page to save a 200ms request would put the
 * description and value of every change into the HTML of a page that mostly
 * shows fifteen columns of summary — paid on every load, for a drawer most
 * people open two or three times.
 *
 * The drawer is a preview, deliberately: read-only, with one link to the real
 * page. Editing here would need the capability checks, the audit trail and the
 * transition rules to be duplicated, and a second place for them to drift.
 */

interface PeekChange {
  id: string;
  pcNumber: string;
  title: string;
  description: string;
  currentStatus: string;
  nextAction: string | null;
  waitingFor: string | null;
  location: string | null;
  sourceType: string;
  sourceLocation: string | null;
  estimatedValue: string | null;
  currentOwner: { fullName: string } | null;
  project: { projectCode: string; projectName: string };
}


export function PeekDrawer() {
  const [id, setId] = useState<string | null>(null);
  const [change, setChange] = useState<PeekChange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setId(null);
    setChange(null);
    setError(null);
    // Send focus back where it came from, or the keyboard user is dumped at the
    // top of the document having lost the row they were on.
    openerRef.current?.focus();
    openerRef.current = null;
  }, []);

  // Click delegation, so the table stays a server component. Anchors are left
  // alone: clicking the PC number should navigate, not peek.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target || target.closest('a')) return;

      const row = target.closest<HTMLElement>('[data-peek]');
      if (!row) return;

      event.preventDefault();
      openerRef.current = target.closest<HTMLElement>('button') ?? row;
      setId(row.dataset.peek ?? null);
    }

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    if (!id) return;

    const controller = new AbortController();
    setChange(null);
    setError(null);

    fetch(`/api/potential-changes/${id}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        setChange((await response.json()) as PeekChange);
      })
      .catch((cause) => {
        if ((cause as Error).name !== 'AbortError') setError('Could not load this change.');
      });

    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    if (!id) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [id, close]);

  if (!id) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex justify-end bg-black/30 print:hidden"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={change ? `${change.pcNumber} preview` : 'Change preview'}
        tabIndex={-1}
        className={cn(
          'flex h-full w-full max-w-md flex-col overflow-y-auto border-s border-border bg-card outline-none',
          'motion-safe:animate-in motion-safe:slide-in-from-right motion-safe:duration-200',
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <p className="tabular text-sm font-semibold text-primary">
              {change?.pcNumber ?? 'Loading'}
            </p>
            <p className="mt-0.5 font-medium">{change?.title ?? ''}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close preview"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="flex-1 p-4">
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : !change ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Loading
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{change.description}</p>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Detail label="Project">{change.project.projectCode}</Detail>
                <Detail label="Status">{humanise(change.currentStatus)}</Detail>
                <Detail label="Owner">{change.currentOwner?.fullName ?? 'Unassigned'}</Detail>
                <Detail label="Estimated">
                  {change.estimatedValue
                    ? `AED ${Number(change.estimatedValue).toLocaleString('en-AE')}`
                    : '—'}
                </Detail>
                <Detail label="Where on site">{change.location ?? '—'}</Detail>
                <Detail label="Raised via">
                  {humanise(change.sourceType)}
                  {change.sourceLocation ? (
                    <span className="block text-xs text-muted-foreground">
                      {change.sourceLocation}
                    </span>
                  ) : null}
                </Detail>
              </dl>

              {change.nextAction ? (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Next action</p>
                  <p className="mt-0.5 text-sm">{change.nextAction}</p>
                  {change.waitingFor ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Waiting for {change.waitingFor}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="border-t border-border p-4">
          <Link
            href={`/variations/${id}`}
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            Open the full change
            <ExternalLink aria-hidden className="size-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
