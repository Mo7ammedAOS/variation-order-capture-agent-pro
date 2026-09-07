import type { Metadata } from 'next';
import {
  AlertOctagon, CalendarClock, CalendarX2, ClipboardList,
  FileWarning, FolderKanban, Gavel, HandCoins, Landmark, PiggyBank, ReceiptText,
  RotateCcw, Timer, Wallet,
} from 'lucide-react';
import { requirePageUser } from '@/lib/auth/session';
import { getOverview } from '@/services/dashboard.service';
import { getCommercialPosition } from '@/services/invoice.service';
import { StatCard } from '@/components/domain/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FunnelRail, GaugeRing } from '@/components/domain/readings';
import { formatMoney } from '@/components/domain/money';
import { CountBarChart } from './charts';

export const metadata: Metadata = { title: 'Overview' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requirePageUser();
  const [{ stats, charts }, money] = await Promise.all([
    getOverview(user),
    getCommercialPosition(user),
  ]);

  /*
    The notice ring.

    `charts.byRisk` is already tallied by the service, so this only picks the
    green slice out of it — no counting happens on this page. A company with
    no open changes shows an empty ring rather than a divide-by-zero or a
    flattering 100%.
  */
  const riskCounts = Object.fromEntries(charts.byRisk.map((row) => [row.label, row.count]));
  const changesTracked = charts.byRisk.reduce((sum, row) => sum + row.count, 0);
  const noticesSafe = riskCounts.green ?? 0;

  const approved = Number(money.approvedValue);
  const invoiced = Number(money.invoicedTotal);
  const paid = Number(money.paidTotal);
  const unbilled = Number(money.unbilledValue);
  const outstanding = Number(money.outstandingTotal);
  const overdue = Number(money.overdueTotal);

  const abbreviated = (amount: number) =>
    formatMoney(amount, 'AED', { abbreviate: true });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      {/*
        The hero states the position before any figure is read.

        A dashboard that opens with the word "Overview" has told the reader
        nothing they did not know when they clicked "Overview". This opens with
        the two sentences a director would actually ask for — what is breaching
        and what is owed — and only then lays out the grid.
      */}
      <header>
        {/*
          No greeting here any more — the top bar already says "Welcome,
          Osman", and saying it twice on the same screen makes the second one
          look like a bug. What survives is the only part that was ever
          information: the two sentences a director would actually ask for.
        */}
        <h1 className="page-title">Overview</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {stats.noticesOverdue > 0
            ? `${stats.noticesOverdue} notice${stats.noticesOverdue === 1 ? ' is' : 's are'} past the contractual deadline. `
            : 'No notice is past its deadline. '}
          {unbilled > 0
            ? `${abbreviated(unbilled)} has been agreed by a client and never invoiced.`
            : 'Everything agreed has been applied for.'}
        </p>
      </header>

      {/*
        The instruments, above the grid of counts.

        Three readings that answer the three questions the company is actually
        run on: is the money moving, are we protecting entitlement, and are we
        holding onto the programme. Everything below this is detail.
      */}
      <section aria-label="Position" className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Where the money is</CardTitle>
            <p className="text-xs text-muted-foreground">
              Agreed by the client, then what has actually been asked for and received.
            </p>
          </CardHeader>
          <CardContent>
            <FunnelRail
              stages={[
                {
                  label: 'Agreed by the client',
                  display: abbreviated(approved),
                  amount: approved,
                },
                {
                  label: 'Invoiced',
                  display: abbreviated(invoiced),
                  amount: invoiced,
                  gapNote:
                    unbilled > 0
                      ? `${abbreviated(unbilled)} agreed and not yet applied for`
                      : undefined,
                  gapTone: 'amber',
                },
                {
                  label: 'Received',
                  display: abbreviated(paid),
                  amount: paid,
                  gapNote:
                    overdue > 0
                      ? `${abbreviated(overdue)} is past its payment terms`
                      : outstanding > 0
                        ? `${abbreviated(outstanding)} outstanding, none of it overdue`
                        : undefined,
                  gapTone: overdue > 0 ? 'red' : 'amber',
                },
              ]}
            />
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <Card>
            <CardContent className="p-5 sm:p-5">
              <GaugeRing
                value={noticesSafe}
                total={changesTracked}
                label="Notice clock still safe"
                caption="Open changes where the notice period has not started to run out."
                tone={
                  changesTracked === 0
                    ? 'brand'
                    : noticesSafe === changesTracked
                      ? 'green'
                      : (riskCounts.red ?? 0) > 0
                        ? 'red'
                        : 'amber'
                }
                size={96}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 sm:p-5">
              <GaugeRing
                value={money.time.daysApproved}
                total={money.time.daysClaimed}
                label="Days agreed of days claimed"
                caption={
                  money.time.daysConceded > 0
                    ? `${money.time.daysConceded} days conceded so far.`
                    : 'Nothing conceded on the programme.'
                }
                tone={money.time.daysConceded > 0 ? 'amber' : 'brand'}
                size={96}
              />
            </CardContent>
          </Card>
        </div>
      </section>

      {/*
        Ordered by urgency, not by category: what is already late, then what is
        about to be, then the totals. Someone scanning this for ten seconds
        should land on the overdue figures first.
      */}
      <section aria-labelledby="h-attention" className="flex flex-col gap-3">
        <h2 id="h-attention" className="text-sm font-bold tracking-[-0.01em] text-muted-foreground">
          Needs attention now
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Notices overdue"
          value={stats.noticesOverdue}
          icon={CalendarX2}
          tone={stats.noticesOverdue > 0 ? 'red' : 'green'}
          hint={stats.noticesOverdue > 0 ? 'Contractual deadline passed' : 'Nothing overdue'}
          href="/variations?risk=red"
        />
        <StatCard
          label="Notices due in 7 days"
          value={stats.noticesDueWithin7Days}
          icon={CalendarClock}
          tone={stats.noticesDueWithin7Days > 0 ? 'amber' : 'neutral'}
          href="/variations?dueWithin=7"
        />
        <StatCard
          label="Overdue tasks"
          value={stats.overdueTasks}
          icon={Timer}
          tone={stats.overdueTasks > 0 ? 'red' : 'green'}
          href="/my-tasks"
        />
        <StatCard
          label="Badly held up"
          value={stats.criticalBottlenecks}
          icon={AlertOctagon}
          tone={stats.criticalBottlenecks > 0 ? 'red' : 'green'}
          href="/bottlenecks"
        />
        <StatCard
          label="Tasks due today"
          value={stats.tasksDueToday}
          icon={ClipboardList}
          href="/my-tasks"
        />
        <StatCard
          label="Notice assessment required"
          value={stats.noticeAssessmentRequired}
          icon={Gavel}
          tone={stats.noticeAssessmentRequired > 0 ? 'amber' : 'neutral'}
          href="/variations?status=notice_assessment"
        />
        <StatCard
          label="New potential changes"
          value={stats.newPotentialChanges}
          icon={FileWarning}
          href="/variations?status=new_potential_change"
        />
        <StatCard label="Active projects" value={stats.activeProjects} icon={FolderKanban} href="/projects" />
        <StatCard
          label="Estimated value at stake"
          value={formatMoney(stats.potentialChangeEstimatedValue, 'AED', { abbreviate: true })}
          icon={Wallet}
          hint="Open potential changes"
        />
        </div>
      </section>

      {/*
        The money end, kept apart from the risk cards above.

        These four are the only figures here computed from what the CLIENT has
        agreed rather than from what the company thinks. "Approved but unbilled"
        is the one that justifies the product: work argued for, won, and never
        invoiced. It is the number nobody could produce before these tables
        existed.
      */}
      <section aria-labelledby="h-money" className="flex flex-col gap-3">
        <h2 id="h-money" className="text-sm font-bold tracking-[-0.01em] text-muted-foreground">
          The money
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Approved, not invoiced"
          value={formatMoney(Number(money.unbilledValue), 'AED', { abbreviate: true })}
          icon={HandCoins}
          tone={Number(money.unbilledValue) > 0 ? 'amber' : 'green'}
          hint={
            money.unbilledCount > 0
              ? `${money.unbilledCount} variation${money.unbilledCount === 1 ? '' : 's'} agreed and unbilled`
              : 'Everything agreed has been applied for'
          }
          href="/variations"
        />
        <StatCard
          label="Invoiced, unpaid"
          value={formatMoney(Number(money.outstandingTotal), 'AED', { abbreviate: true })}
          icon={ReceiptText}
          hint="Applied for and not yet received"
        />
        <StatCard
          label="Overdue payment"
          value={formatMoney(Number(money.overdueTotal), 'AED', { abbreviate: true })}
          icon={Landmark}
          tone={Number(money.overdueTotal) > 0 ? 'red' : 'green'}
          hint={
            money.overdueCount > 0
              ? `${money.overdueCount} invoice${money.overdueCount === 1 ? '' : 's'} past terms`
              : 'Nothing past its terms'
          }
        />
        <StatCard
          label="Conceded on variations"
          value={formatMoney(Number(money.shortfallValue), 'AED', { abbreviate: true })}
          icon={Wallet}
          hint="Submitted less what the client agreed"
        />
        </div>
      </section>

      {/*
        Retention and time — the two things a fit-out contractor loses without
        ever deciding to.

        Retention is money already earned that somebody else is holding, and it
        comes back only if a person remembers to ask. Days are the second
        currency on a job: conceding ninety of them across eleven variations is
        giving away the programme, and until the figure is added up nobody in
        the company can see it happening.
      */}
      <section aria-labelledby="h-retention" className="flex flex-col gap-3">
        <h2 id="h-retention" className="text-sm font-bold tracking-[-0.01em] text-muted-foreground">
          Retention and time
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Retention held"
          value={formatMoney(Number(money.retentionHeld), 'AED', { abbreviate: true })}
          icon={PiggyBank}
          tone={Number(money.retentionHeld) > 0 ? 'amber' : 'green'}
          hint={
            Number(money.retentionReleasedTotal) > 0
              ? `${formatMoney(Number(money.retentionReleasedTotal), 'AED', { abbreviate: true })} already released`
              : 'Earned, withheld, not yet asked back'
          }
        />
        <StatCard
          label="Credited back"
          value={formatMoney(Number(money.creditedTotal), 'AED', { abbreviate: true })}
          icon={RotateCcw}
          hint="Issued credit notes against applications"
        />
        <StatCard
          label="Days claimed"
          value={String(money.time.daysClaimed)}
          icon={CalendarClock}
          hint={
            money.time.awaitingCount > 0
              ? `${money.time.awaitingCount} time claim${money.time.awaitingCount === 1 ? '' : 's'} unanswered`
              : `${money.time.daysApproved} agreed by the client`
          }
        />
        <StatCard
          label="Days conceded"
          value={String(money.time.daysConceded)}
          icon={CalendarX2}
          tone={money.time.daysConceded > 0 ? 'red' : 'green'}
          hint="Claimed less what the client agreed"
        />
        </div>
      </section>

      <section aria-labelledby="h-breakdowns" className="flex flex-col gap-3">
        <h2 id="h-breakdowns" className="text-sm font-bold tracking-[-0.01em] text-muted-foreground">
          Breakdowns
        </h2>
        <div className="grid gap-3 lg:grid-cols-2">
        <CountBarChart title="Potential changes by project" data={charts.byProject} />
        <CountBarChart title="Potential changes by status" data={charts.byStatus} />
        <CountBarChart title="Potential changes by risk" data={charts.byRisk} colourByRisk />
        <CountBarChart title="Overdue tasks by type" data={charts.overdueTasksByRole} />
        </div>
      </section>
    </div>
  );
}
