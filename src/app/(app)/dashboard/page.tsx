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

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Where the commercial risk is right now, across the projects you can see.
        </p>
      </header>

      {/*
        Ordered by urgency, not by category: what is already late, then what is
        about to be, then the totals. Someone scanning this for ten seconds
        should land on the overdue figures first.
      */}
      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
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
      </section>

      {/*
        The money end, kept apart from the risk cards above.

        These four are the only figures here computed from what the CLIENT has
        agreed rather than from what the company thinks. "Approved but unbilled"
        is the one that justifies the product: work argued for, won, and never
        invoiced. It is the number nobody could produce before these tables
        existed.
      */}
      <section aria-label="The money" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
      <section aria-label="Retention and time" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
      </section>

      <section aria-label="Breakdowns" className="grid gap-4 lg:grid-cols-2">
        <CountBarChart title="Potential changes by project" data={charts.byProject} />
        <CountBarChart title="Potential changes by status" data={charts.byStatus} />
        <CountBarChart title="Potential changes by risk" data={charts.byRisk} colourByRisk />
        <CountBarChart title="Overdue tasks by type" data={charts.overdueTasksByRole} />
      </section>
    </div>
  );
}
