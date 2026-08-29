import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
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
    currentStatus: { notIn: ['cancelled', 'included_scope'] },
  };

  const [
    activeProjects,
    newPotentialChanges,
    noticeAssessmentRequired,
    noticesDueWithin7Days,
    noticesOverdue,
    valueAggregate,
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

/**
 * Trade acronyms, which are not words and must not be title-cased into ones.
 *
 * `qs_pricing` became "Qs Pricing" on the printed register — a document that
 * goes to a consultant. In this industry QS, CM and PM are how people are
 * addressed, and getting them wrong on a commercial document reads as though
 * the document was produced by somebody who does not work here.
 */
const ACRONYMS = new Set(['qs', 'pm', 'cm', 'md', 'mep', 'eot', 'vo', 'rfi', 'si', 'boq', 'hse']);

/** Proper nouns that own their own capitalisation. */
const PROPER_NOUNS: Record<string, string> = {
  whatsapp: 'WhatsApp',
};

export function humanise(value: string): string {
  const words = value.replace(/_/g, ' ').split(' ');

  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return word.toUpperCase();
      if (PROPER_NOUNS[lower]) return PROPER_NOUNS[lower];
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      return word;
    })
    .join(' ');
}
