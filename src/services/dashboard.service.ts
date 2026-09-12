import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { humanise } from '@/lib/labels';
import { NOTICE_OUTSTANDING_STATUSES } from '@/services/notice.service';
import { todayUtc } from '@/lib/dates';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { assertProjectAccess, scopeToUser, scopeProjectsToUser } from '@/services/project-access.service';

/**
 * Dashboard aggregates.
 *
 * Every figure here is computed server-side, inside the caller's project scope.
 * A director sees company totals because their system role reaches every
 * project; a PM sees the same cards computed over their projects only. The UI
 * never sums anything — if a number is wrong it is wrong in one place.
 */

export interface OverviewStats {
  activeProjects: number;
  newPotentialChanges: number;
  noticeAssessmentRequired: number;
  noticesDueWithin7Days: number;
  noticesOverdue: number;
  potentialChangeEstimatedValue: number;

  /**
   * The three figures a commercial manager takes to a board meeting.
   *
   * They were absent, and their absence was the reason the dashboard read as
   * an operations screen rather than a commercial one: it counted work and
   * never counted money.
   */
  /** Put to the client, no answer yet. The number that is out of our hands. */
  pendingVoValue: number;
  /** What the client actually agreed, which is not what we submitted. */
  approvedVoValue: number;
  /** Changes where work is under way and nobody has agreed to pay for it. */
  workStartedUnapproved: number;
  workStartedUnapprovedValue: number;

  criticalBottlenecks: number;
  tasksDueToday: number;
  overdueTasks: number;
}

export interface OverviewCharts {
  byProject: { label: string; count: number }[];
  byStatus: { label: string; count: number }[];
  byRisk: { label: string; count: number }[];
  overdueTasksByRole: { label: string; count: number }[];
}

export async function getOverview(
  user: AuthenticatedUser,
): Promise<{ stats: OverviewStats; charts: OverviewCharts }> {
  const scope = await scopeToUser(user);
  const projectScope = await scopeProjectsToUser(user);
  const today = todayUtc();

  const in7Days = new Date(today);
  in7Days.setUTCDate(in7Days.getUTCDate() + 7);

  const openChange: Prisma.PotentialChangeWhereInput = {
    ...scope,
    currentStatus: { notIn: ['cancelled', 'included_scope', 'variation_approved'] },
  };

  const [
    activeProjects,
    newPotentialChanges,
    noticeAssessmentRequired,
    noticesDueWithin7Days,
    noticesOverdue,
    valueAggregate,
    pendingVo,
    approvedVo,
    unapprovedWork,
    criticalBottlenecks,
    tasksDueToday,
    overdueTasks,
    changes,
    overdueTaskRows,
  ] = await Promise.all([
    prisma.project.count({ where: { ...projectScope, projectStatus: { in: ['active', 'awarded'] } } }),
    prisma.potentialChange.count({ where: { ...scope, currentStatus: 'new_potential_change' } }),
    prisma.potentialChange.count({ where: { ...scope, noticeStatus: 'not_assessed' } }),
    prisma.potentialChange.count({
      where: { ...openChange, noticeDueDate: { gte: today, lte: in7Days } },
    }),
    prisma.potentialChange.count({
      where: { ...openChange, noticeDueDate: { lt: today }, noticeStatus: { in: [...NOTICE_OUTSTANDING_STATUSES] } },
    }),
    prisma.potentialChange.aggregate({ where: openChange, _sum: { estimatedValue: true } }),
    /*
      Pending is `submitted` AND still awaiting an answer, not simply
      `submitted`. A variation the client rejected last month is also in the
      submitted family, and counting it as pending would inflate the one figure
      nobody may be wrong about.
    */
    prisma.variationOrder.aggregate({
      where: { ...scope, status: 'submitted', clientResponse: 'awaiting' },
      _sum: { submittedValue: true },
    }),
    /*
      `approvedValue`, never `submittedValue`. A part approval is the client
      agreeing a LOWER figure, and reporting what we asked for as though they
      agreed it is how a forecast quietly becomes fiction.
    */
    prisma.variationOrder.aggregate({
      where: { ...scope, status: { in: ['approved', 'part_approved'] } },
      _sum: { approvedValue: true },
    }),
    /*
      Work started without approval: the most expensive thing on a fit-out job
      and, until now, a number this system held every component of and never
      put on a screen. Work is under way or finished on the ground, and the
      change has not reached `variation_approved` -- so if the client says no,
      it was done for nothing.

      `included_scope` is excluded because that is the QS finding it was
      already in the contract, which is a correct outcome, not exposure.
    */
    prisma.potentialChange.aggregate({
      where: {
        ...scope,
        workStatus: { in: ['in_progress', 'completed'] },
        currentStatus: { notIn: ['variation_approved', 'included_scope', 'cancelled'] },
      },
      _count: { _all: true },
      _sum: { estimatedValue: true },
    }),
    prisma.bottleneck.count({ where: { ...scope, resolvedAt: null, riskLevel: 'red' } }),
    prisma.task.count({ where: { ...scope, dueDate: today, status: { in: ['open', 'in_progress'] } } }),
    prisma.task.count({
      where: { ...scope, dueDate: { lt: today }, status: { in: ['open', 'in_progress', 'blocked'] } },
    }),
    prisma.potentialChange.findMany({
      where: scope,
      select: {
        currentStatus: true,
        riskLevel: true,
        project: { select: { projectCode: true } },
      },
    }),
    prisma.task.findMany({
      where: { ...scope, dueDate: { lt: today }, status: { in: ['open', 'in_progress', 'blocked'] } },
      select: { taskType: true },
    }),
  ]);

  return {
    stats: {
      activeProjects,
      newPotentialChanges,
      noticeAssessmentRequired,
      noticesDueWithin7Days,
      noticesOverdue,
      potentialChangeEstimatedValue: Number(valueAggregate._sum.estimatedValue ?? 0),
      pendingVoValue: Number(pendingVo._sum.submittedValue ?? 0),
      approvedVoValue: Number(approvedVo._sum.approvedValue ?? 0),
      workStartedUnapproved: unapprovedWork._count._all,
      workStartedUnapprovedValue: Number(unapprovedWork._sum.estimatedValue ?? 0),
      criticalBottlenecks,
      tasksDueToday,
      overdueTasks,
    },
    charts: {
      byProject: tally(changes.map((c) => c.project.projectCode)),
      byStatus: tally(changes.map((c) => humanise(c.currentStatus))),
      byRisk: tally(changes.map((c) => c.riskLevel)),
      overdueTasksByRole: tally(overdueTaskRows.map((t) => humanise(t.taskType))),
    },
  };
}

export async function getProjectDashboard(user: AuthenticatedUser, projectId: string) {
  await assertProjectAccess(user, projectId);
  const today = todayUtc();

  const [project, changes, openTasks, bottlenecks, valueAggregate] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      include: { contractRules: true },
    }),
    prisma.potentialChange.groupBy({
      by: ['currentStatus'],
      where: { projectId },
      _count: { _all: true },
    }),
    prisma.task.count({
      where: { projectId, status: { in: ['open', 'in_progress', 'blocked'] } },
    }),
    prisma.bottleneck.count({ where: { projectId, resolvedAt: null } }),
    prisma.potentialChange.aggregate({
      where: { projectId, currentStatus: { notIn: ['cancelled'] } },
      _sum: { estimatedValue: true },
    }),
  ]);

  const noticesOverdue = await prisma.potentialChange.count({
    where: {
      projectId,
      noticeDueDate: { lt: today },
      noticeStatus: { in: [...NOTICE_OUTSTANDING_STATUSES] },
    },
  });

  return {
    project,
    byStatus: changes.map((row) => ({ label: humanise(row.currentStatus), count: row._count._all })),
    openTasks,
    bottlenecks,
    noticesOverdue,
    estimatedValue: Number(valueAggregate._sum.estimatedValue ?? 0),
  };
}

function tally(values: string[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

/** Re-exported so existing imports from this service keep working. */
export { humanise };
