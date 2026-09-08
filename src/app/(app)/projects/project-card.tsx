import Link from 'next/link';
import {
  Building2, CalendarClock, FileWarning, HardHat, UserRound, Wallet,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/domain/money';
import { StatusChip } from '@/components/domain/risk-chip';
import { cn } from '@/lib/utils';

/**
 * A project, as a card.
 *
 * ── Why this replaced a ten-column table ──────────────────────────────────
 * The register had Code, Project, Client, Consultant, Contract value, PM, QS,
 * CM, Status and Changes. Ten columns for a list that is rarely more than a
 * dozen rows, and which nobody scans down a column of: you do not ask "who is
 * the QS on all my jobs", you ask "what is the state of DXB-001". A table is
 * the right shape for comparing hundreds of rows on one axis; this list is
 * neither hundreds nor compared.
 *
 * There were also two separate implementations — a table above `md` and a
 * cut-down card list below it — which is two things to keep in step and one of
 * them always showing less. This is one component at every width.
 *
 * ── The structure ─────────────────────────────────────────────────────────
 * Header, body, footer. The header carries identity (who is this), the body
 * the facts a person came for, and the footer the one number that says whether
 * anything is happening. Labels sit on the left with an icon, values on the
 * right — a shape people read as a spec sheet rather than as prose.
 */

/** Two initials from a name, for the little avatar discs. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
  return (last ? `${first[0] ?? ''}${last[0] ?? ''}` : first.slice(0, 2) || '?').toUpperCase();
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Building2;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="flex min-w-0 shrink-0 items-center gap-2 text-sm text-muted-foreground">
        <Icon aria-hidden className="size-4 shrink-0 opacity-70" />
        {label}
      </span>
      {/* `min-w-0` and the truncate below are what stop a long consultant name
          pushing the label off the card instead of ellipsising itself. */}
      <span className="min-w-0 text-end text-sm font-semibold">{children}</span>
    </div>
  );
}

/** A name with its initials, the way the reference shows a contact. */
function Person({ name }: { name: string }) {
  if (name === '—') return <span className="text-muted-foreground">—</span>;
  return (
    <span className="glass-lens inline-flex max-w-full items-center gap-1.5 rounded-full py-0.5 pe-2.5 ps-0.5">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--muted)] text-[9px] font-extrabold text-muted-foreground">
        {initials(name)}
      </span>
      <span className="truncate text-xs font-semibold">{name}</span>
    </span>
  );
}

export interface ProjectCardData {
  id: string;
  projectCode: string;
  projectName: string;
  clientName: string;
  consultantName: string | null;
  contractValue: string | null;
  currency: string;
  projectStatus: string;
  changeCount: number;
  projectManager: string;
  quantitySurveyor: string;
}

export function ProjectCard({ project }: { project: ProjectCardData }) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className="group block rounded-[var(--panel-radius)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
    >
      <Card
        interactive
        /*
          Flat, not blurred, because this is a grid tile.

          `.panel` carries a `backdrop-filter`, and each one costs the
          compositor a full sample of the plate behind it — so a page of them
          is where a mid-range Android in a site office starts dropping frames.
          The rule the stylesheet states for itself is "grid items are flat,
          surfaces and chrome are glass", and `StatCard` already follows it for
          the same reason.

          Nothing is lost: our ground is a soft-focus photograph with almost no
          high-frequency detail, so at tile size a slightly more opaque flat
          surface and a blurred one are indistinguishable. The card still lifts
          on hover — that is `interactive`, and it is free.
        */
        blur={false}
        className="flex h-full flex-col p-3"
      >
        <div className="flex items-center gap-2.5 px-2 py-2">
          {/*
            The tile carries the brand, so a wall of cards has one lime accent
            each rather than none — but it holds an initial, not a logo. Every
            client on a fit-out job has a different mark and we have none of
            them; a letter is honest and never renders as a broken image.
          */}
          <span className="brand-fill flex size-9 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold shadow-[var(--brand-glow)]">
            {project.projectName.trim().charAt(0).toUpperCase() || '?'}
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate font-bold tracking-[-0.02em]">
              {project.projectName}
            </span>
          </span>

          <span className="tabular shrink-0 text-xs font-bold text-muted-foreground">
            {project.projectCode}
          </span>
        </div>

        {/* The facts, in a recess — the same treatment as a form field, because
            this is read-only data rather than another surface on top. */}
        <div className="glass-inset mt-1 flex-1 px-3.5 py-1">
          <Row icon={Building2} label="Client">
            <span className="block truncate">{project.clientName}</span>
          </Row>
          <Row icon={UserRound} label="Consultant">
            <span className="block truncate text-muted-foreground">
              {project.consultantName ?? '—'}
            </span>
          </Row>
          <Row icon={Wallet} label="Contract">
            <Money value={project.contractValue} currency={project.currency} abbreviate />
          </Row>
          <Row icon={HardHat} label="Manager">
            <Person name={project.projectManager} />
          </Row>
          <Row icon={UserRound} label="QS">
            <Person name={project.quantitySurveyor} />
          </Row>
          <Row icon={CalendarClock} label="Status">
            <StatusChip status={project.projectStatus} />
          </Row>
        </div>

        <div className="flex items-center justify-between gap-3 px-2 pb-1 pt-3">
          <span
            className={cn(
              'flex items-center gap-1.5 text-xs font-semibold',
              project.changeCount > 0 ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <FileWarning aria-hidden className="size-3.5" />
            {project.changeCount}{' '}
            {project.changeCount === 1 ? 'potential change' : 'potential changes'}
          </span>
          <Badge variant="secondary" className="shrink-0 group-hover:text-foreground">
            Open
          </Badge>
        </div>
      </Card>
    </Link>
  );
}
