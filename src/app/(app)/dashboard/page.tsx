import type { Metadata } from 'next';
import Link from 'next/link';
import { BarChart3, CalendarX2, HandCoins, HardHat, Plus, Wallet } from 'lucide-react';
import { requirePageUser } from '@/lib/auth/session';
import { getDashboard } from '@/services/dashboard-queue.service';
import {
  PERSONA_KPIS,
  PERSONA_SHOWS_PROJECT_TABLE,
  QUEUE_FILTERS,
  QUEUE_SORTS,
  filterActions,
  sortActions,
  type KpiKey,
  type QueueFilter,
  type QueueSort,
} from '@/lib/dashboard-metrics';
import { StatCard } from '@/components/domain/stat-card';
import { Money, formatMoney } from '@/components/domain/money';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ActionQueue } from './action-queue';

export const metadata: Metadata = { title: 'Overview' };
export const dynamic = 'force-dynamic';

/**
 * The primary dashboard.
 *
 * ── What it replaced, and why ─────────────────────────────────────────────
 * Twenty-six cards, two gauges, a funnel and four charts. Every figure was
 * true and the screen still failed, because twenty-six numbers of equal size
 * ask the reader to decide which matter — the job the dashboard existed to do.
 * A PM opening it could not tell which change to handle first.
 *
 * So: four figures promoted, one action queue, one pipeline, one project
 * table. Everything removed is on /reports, with the same calculations behind
 * it. Nothing was deleted.
 *
 * ── The one rule for adding anything here ─────────────────────────────────
 * A number earns a place on this page only if a person would DO something
 * differently on seeing it. Retention held is true, useful and on the reports
 * page, because nobody has ever changed their morning because of it.
 */

const KPI_LIMIT = 25;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePageUser();
  const params = await searchParams;
  const { persona, money, actions, pipeline, projects } = await getDashboard(user);

  const filter = readFilter(params.queue);
  const sort = readSort(params.sort);

  const filtered = sortActions(filterActions(actions, filter, user.id), sort);
  const visible = filtered.slice(0, KPI_LIMIT);

  const kpis = PERSONA_KPIS[persona];
  const red = actions.filter((row) => row.priority === 'red').length;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Overview</h1>
          {/*
            One sentence, and it states the position rather than naming the
            page. A heading that says "Overview" has told the reader nothing
            they did not know when they clicked "Overview".
          */}
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {red > 0
              ? `${red} thing${red === 1 ? '' : 's'} need${red === 1 ? 's' : ''} doing now. `
              : 'Nothing is overdue. '}
            {money.workStartedValue > 0
              ? `${formatMoney(money.workStartedValue, 'AED', { abbreviate: true })} of work has started without approval.`
              : 'No work has started without approval.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/report-change">
            <Button variant="secondary">
              <Plus aria-hidden className="size-4" />
              Report a change
            </Button>
          </Link>
          {persona !== 'site_engineer' ? (
            <Link href="/reports">
              <Button variant="ghost">
                <BarChart3 aria-hidden className="size-4" />
                Commercial Reports
              </Button>
            </Link>
          ) : null}
        </div>
      </header>

      {/* ── 1 · MONEY AND RISK ─────────────────────────────────────────────
          Four, never more. A fifth would start the slide back to twenty-six,
          and the site engineer gets none of them: he cannot invoice, cannot
          approve, and a row of figures he cannot move teaches him the app is
          not for him. */}
      {kpis.length > 0 ? (
        <section aria-labelledby="h-money" className="flex flex-col gap-3">
          <h2 id="h-money" className="text-base font-bold tracking-[-0.01em]">
            Money and risk
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kpis.map((key) => (
              <Kpi key={key} which={key} money={money} />
            ))}
          </div>
        </section>
      ) : null}

      {/* ── 2 · NEEDS ACTION TODAY ─────────────────────────────────────── */}
      <ActionQueue
        rows={visible}
        total={filtered.length}
        filter={filter}
        sort={sort}
        limit={KPI_LIMIT}
      />

      {/* ── 3 · CHANGE WORKFLOW ────────────────────────────────────────── */}
      <section aria-labelledby="h-pipeline" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <h2 id="h-pipeline" className="text-base font-bold tracking-[-0.01em]">
            Change workflow
          </h2>
          <Link href="/variations" className="text-xs font-semibold underline">
            View all changes
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {pipeline.map((stage) => (
            <Link key={stage.key} href={stage.href}>
              <Card interactive blur={false} className="flex h-full flex-col gap-1 p-3.5">
                <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  {stage.label}
                </p>
                <p className="tabular text-2xl font-extrabold leading-none tracking-[-0.04em]">
                  {stage.count}
                </p>
                <p className="tabular text-xs text-muted-foreground">
                  {formatMoney(stage.value, 'AED', { abbreviate: true })}
                </p>
                {/* The oldest item is the only thing on a pipeline tile that
                    can prompt an action. A stage with four changes is normal;
                    a stage whose oldest has sat twelve days is a decision
                    nobody is making. */}
                <p
                  className={
                    stage.oldestDays >= 14
                      ? 'mt-auto pt-1 text-xs font-semibold text-risk-red'
                      : stage.oldestDays >= 7
                        ? 'mt-auto pt-1 text-xs font-semibold text-risk-amber'
                        : 'mt-auto pt-1 text-xs text-muted-foreground'
                  }
                >
                  {stage.count === 0 ? '—' : `Oldest ${stage.oldestDays}d`}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* ── 4 · PROJECT COMMERCIAL POSITION ────────────────────────────── */}
      {PERSONA_SHOWS_PROJECT_TABLE[persona] && projects.length > 0 ? (
        <section aria-labelledby="h-projects" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 id="h-projects" className="text-base font-bold tracking-[-0.01em]">
              Project commercial position
            </h2>
            <Link href="/projects" className="text-xs font-semibold underline">
              View all projects
            </Link>
          </div>

          <Card className="hidden overflow-hidden p-0 lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                  <th className="p-3 text-start font-semibold">Project</th>
                  <th className="p-3 text-end font-semibold">Pending</th>
                  <th className="p-3 text-end font-semibold">Approved, not invoiced</th>
                  <th className="p-3 text-end font-semibold">Work started without approval</th>
                  <th className="p-3 text-end font-semibold">Open</th>
                  <th className="p-3 text-end font-semibold">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr
                    key={project.projectId}
                    className="border-b border-border/60 last:border-0 hover:bg-secondary/40"
                  >
                    <td className="p-3">
                      <Link
                        href={`/variations?projectId=${project.projectId}`}
                        className="font-semibold hover:underline"
                      >
                        {project.projectName}
                      </Link>
                      <p className="tabular text-xs text-muted-foreground">{project.projectCode}</p>
                    </td>
                    <td className="p-3 text-end">
                      <Money value={project.pendingValue} abbreviate />
                    </td>
                    <td className="p-3 text-end">
                      <Money value={project.approvedNotInvoiced} abbreviate />
                    </td>
                    <td
                      className={
                        project.workStartedUnapproved > 0
                          ? 'p-3 text-end font-bold text-risk-red'
                          : 'p-3 text-end text-muted-foreground'
                      }
                    >
                      <Money value={project.workStartedUnapproved} abbreviate />
                    </td>
                    <td className="tabular p-3 text-end">{project.openChanges}</td>
                    <td
                      className={
                        project.overdueActions > 0
                          ? 'tabular p-3 text-end font-bold text-risk-red'
                          : 'tabular p-3 text-end text-muted-foreground'
                      }
                    >
                      {project.overdueActions}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="flex flex-col gap-2 lg:hidden">
            {projects.map((project) => (
              <Link key={project.projectId} href={`/variations?projectId=${project.projectId}`}>
                <Card interactive className="flex flex-col gap-1.5 p-4">
                  <p className="text-sm font-bold">{project.projectName}</p>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Pending</dt>
                    <dd className="text-end">
                      <Money value={project.pendingValue} abbreviate />
                    </dd>
                    <dt className="text-muted-foreground">Approved, not invoiced</dt>
                    <dd className="text-end">
                      <Money value={project.approvedNotInvoiced} abbreviate />
                    </dd>
                    <dt className="text-muted-foreground">Started without approval</dt>
                    <dd
                      className={
                        project.workStartedUnapproved > 0
                          ? 'text-end font-bold text-risk-red'
                          : 'text-end'
                      }
                    >
                      <Money value={project.workStartedUnapproved} abbreviate />
                    </dd>
                    <dt className="text-muted-foreground">Open changes</dt>
                    <dd className="tabular text-end">{project.openChanges}</dd>
                  </dl>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/**
 * The four, each with the count under the money.
 *
 * A value without a count cannot be acted on: "AED 84,000 pending" could be
 * one large variation or thirty small ones, and those are different mornings.
 */
function Kpi({
  which,
  money,
}: {
  which: KpiKey;
  money: Awaited<ReturnType<typeof getDashboard>>['money'];
}) {
  const abbreviated = (amount: number) => formatMoney(amount, 'AED', { abbreviate: true });

  switch (which) {
    case 'pending':
      return (
        <StatCard
          label="Pending change value"
          value={abbreviated(money.pendingValue)}
          hint={`${money.pendingCount} change${money.pendingCount === 1 ? '' : 's'} not yet agreed by the client`}
          icon={Wallet}
          href="/variations"
        />
      );
    case 'approved_not_invoiced':
      return (
        <StatCard
          label="Approved, not invoiced"
          value={abbreviated(money.approvedNotInvoiced)}
          hint={
            money.approvedNotInvoicedCount > 0
              ? `${money.approvedNotInvoicedCount} agreed and never applied for`
              : 'Everything agreed has been applied for'
          }
          icon={HandCoins}
          tone={money.approvedNotInvoiced > 0 ? 'amber' : 'green'}
          href="/variations?status=with_client"
        />
      );
    case 'work_started_unapproved':
      // The only card allowed to shout. It is the one figure on the page that
      // can still be prevented — everything else is money already spent.
      return (
        <StatCard
          label="Work started without approval"
          value={abbreviated(money.workStartedValue)}
          hint={
            money.workStartedCount > 0
              ? `${money.workStartedCount} change${money.workStartedCount === 1 ? '' : 's'} being built with nobody agreeing to pay`
              : 'Nothing is being built unapproved'
          }
          icon={HardHat}
          tone={money.workStartedValue > 0 ? 'red' : 'green'}
          href="/variations"
        />
      );
    case 'client_overdue':
      return (
        <StatCard
          label="Overdue client decisions"
          value={abbreviated(money.clientOverdueValue)}
          hint={
            money.clientOverdueCount > 0
              ? `${money.clientOverdueCount} waiting, oldest ${money.clientOverdueOldestDays} days`
              : 'No client is past their response window'
          }
          icon={CalendarX2}
          tone={money.clientOverdueCount > 0 ? 'red' : 'green'}
          href="/variations?status=with_client"
        />
      );
  }
}

/** An unknown value in the address bar falls back rather than erroring. */
function readFilter(value: string | undefined): QueueFilter {
  return QUEUE_FILTERS.some((entry) => entry.value === value)
    ? (value as QueueFilter)
    : 'all';
}

function readSort(value: string | undefined): QueueSort {
  return QUEUE_SORTS.some((entry) => entry.value === value) ? (value as QueueSort) : 'priority';
}
