import type { Metadata } from 'next';
import {
  AlertOctagon, CalendarClock, CalendarX2, ClipboardList,
  FileWarning, FolderKanban, Gavel, Timer, Wallet,
} from 'lucide-react';
import { requirePageUser } from '@/lib/auth/session';
import { getOverview } from '@/services/dashboard.service';
import { StatCard } from '@/components/domain/stat-card';
import { formatMoney } from '@/components/domain/money';
import { CountBarChart } from './charts';

export const metadata: Metadata = { title: 'Overview' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requirePageUser();
  const { stats, charts } = await getOverview(user);

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
          label="Critical bottlenecks"
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

      <section aria-label="Breakdowns" className="grid gap-4 lg:grid-cols-2">
        <CountBarChart title="Potential changes by project" data={charts.byProject} />
        <CountBarChart title="Potential changes by status" data={charts.byStatus} />
        <CountBarChart title="Potential changes by risk" data={charts.byRisk} colourByRisk />
        <CountBarChart title="Overdue tasks by type" data={charts.overdueTasksByRole} />
      </section>
    </div>
  );
}
