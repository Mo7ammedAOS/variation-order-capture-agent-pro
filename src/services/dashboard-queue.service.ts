import 'server-only';
import { prisma } from '@/lib/prisma';
import { todayUtc } from '@/lib/dates';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { scopeToUser, scopeProjectsToUser } from '@/services/project-access.service';
import { hasCapability } from '@/services/permissions.service';
import { customerStatus } from '@/lib/status-labels';
import { getCommercialPosition } from '@/services/invoice.service';
import {
  ACTION_NEXT,
  ACTION_OWNER_ROLE,
  actionsForPersona,
  buildPipeline,
  changeValue,
  daysBetween,
  isClientDecisionOverdue,
  isPendingChange,
  isWorkStartedUnapproved,
  personaFor,
  priorityFor,
  rankProjects,
  type ActionRow,
  type ActionType,
  type Persona,
  type PipelineStage,
  type ProjectPosition,
} from '@/lib/dashboard-metrics';

/**
 * Everything the primary dashboard renders, in one call.
 *
 * ── Why one query, not twenty-six ─────────────────────────────────────────
 * The old overview fired twenty aggregate counts in parallel. Each was cheap;
 * together they were twenty round trips to Singapore before the page could
 * start. This reads the open changes once — with the notice, the variation
 * order and the names already joined — and derives every figure from those
 * rows in memory. The classification is pure and lives in `dashboard-metrics`,
 * so the numbers on this screen are the same functions the tests prove.
 *
 * `getOverview` in `dashboard.service.ts` is untouched: `/api/dashboard/
 * overview` still answers with exactly what it always did.
 */

const OPEN_LIMIT = 500;

export interface DashboardData {
  persona: Persona;
  money: {
    pendingValue: number;
    pendingCount: number;
    approvedNotInvoiced: number;
    approvedNotInvoicedCount: number;
    workStartedValue: number;
    workStartedCount: number;
    clientOverdueValue: number;
    clientOverdueCount: number;
    clientOverdueOldestDays: number;
  };
  actions: ActionRow[];
  pipeline: PipelineStage[];
  projects: ProjectPosition[];
}

export async function getDashboard(user: AuthenticatedUser): Promise<DashboardData> {
  const [scope, projectScope] = await Promise.all([scopeToUser(user), scopeProjectsToUser(user)]);
  const today = todayUtc();

  const [changes, blockages, rules, projects, persona, commercial] = await Promise.all([
    prisma.potentialChange.findMany({
      where: { ...scope, currentStatus: { notIn: ['included_scope', 'cancelled'] } },
      take: OPEN_LIMIT,
      orderBy: { captureDate: 'desc' },
      select: {
        id: true,
        pcNumber: true,
        title: true,
        projectId: true,
        currentStatus: true,
        workStatus: true,
        estimatedValue: true,
        submittedValue: true,
        captureDate: true,
        nextActionDueDate: true,
        noticeRequired: true,
        noticeStatus: true,
        noticeDueDate: true,
        noticeMissingInformation: true,
        currentOwnerUserId: true,
        reportedByUserId: true,
        project: { select: { projectName: true, projectCode: true } },
        currentOwner: { select: { fullName: true } },
        reportedBy: { select: { fullName: true } },
        // Newest first, one row: a superseded notice is history, and the
        // question on this screen is always about the one now in force.
        notices: {
          where: { kind: 'notice' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            acknowledgedAt: true,
            notification: { select: { status: true } },
          },
        },
        variationOrder: {
          select: {
            status: true,
            clientResponse: true,
            submittedAt: true,
            submittedValue: true,
            approvedValue: true,
          },
        },
      },
    }),
    prisma.bottleneck.findMany({
      where: { ...scope, resolvedAt: null },
      select: {
        id: true,
        potentialChangeId: true,
        blockerReason: true,
        overdueDays: true,
        riskLevel: true,
        blockedByRole: true,
      },
    }),
    prisma.projectContractRule.findMany({ select: { projectId: true, voResponseDays: true } }),
    prisma.project.findMany({
      where: { ...projectScope, projectStatus: { in: ['active', 'awarded'] } },
      select: { id: true, projectName: true, projectCode: true },
    }),
    resolvePersona(user),
    getCommercialPosition(user),
  ]);

  const responseDays = new Map(rules.map((rule) => [rule.projectId, rule.voResponseDays]));
  const blockedByChange = new Map(
    blockages.filter((b) => b.potentialChangeId).map((b) => [b.potentialChangeId!, b]),
  );

  const rows = changes.map((change) => {
    const vo = change.variationOrder;
    return {
      ...change,
      value: changeValue({
        submittedValue: change.submittedValue ? Number(change.submittedValue) : null,
        estimatedValue: change.estimatedValue ? Number(change.estimatedValue) : null,
      }),
      ageDays: Math.max(0, daysBetween(change.captureDate, today)),
      clientResponse: vo?.clientResponse ?? null,
      voShape: vo
        ? { submitted: vo.status === 'submitted' || vo.submittedAt !== null, answered: vo.clientResponse !== 'awaiting' }
        : null,
    };
  });

  /* ── the four figures ─────────────────────────────────────────────────── */

  const pending = rows.filter((row) =>
    isPendingChange({ currentStatus: row.currentStatus, clientResponse: row.clientResponse }),
  );
  const started = rows.filter((row) =>
    isWorkStartedUnapproved({ workStatus: row.workStatus, currentStatus: row.currentStatus }),
  );
  const clientOverdue = rows.filter(
    (row) =>
      row.variationOrder &&
      isClientDecisionOverdue(
        {
          status: row.variationOrder.status,
          clientResponse: row.variationOrder.clientResponse,
          submittedAt: row.variationOrder.submittedAt,
        },
        responseDays.get(row.projectId) ?? 14,
        today,
      ),
  );

  /* ── the queue ────────────────────────────────────────────────────────── */

  const actions: ActionRow[] = [];

  for (const row of rows) {
    const base = {
      changeId: row.id,
      reference: row.pcNumber,
      description: row.title,
      projectId: row.projectId,
      projectName: row.project.projectName,
      value: row.value,
      ageDays: row.ageDays,
      status: customerStatus(row.currentStatus, row.voShape),
    };

    const push = (
      type: ActionType,
      extra: {
        dueDate?: Date | null;
        overdueDays?: number | null;
        ownerName?: string | null;
        ownerUserId?: string | null;
        nextAction?: string;
        priority?: ActionRow['priority'];
        hash?: string;
      } = {},
    ) => {
      const overdueDays = extra.overdueDays ?? null;
      actions.push({
        key: `${row.id}:${type}`,
        type,
        priority: extra.priority ?? priorityFor({ overdueDays }),
        ...base,
        ownerName: extra.ownerName ?? row.currentOwner?.fullName ?? 'Unassigned',
        ownerUserId: extra.ownerUserId ?? row.currentOwnerUserId,
        ownerRole: ACTION_OWNER_ROLE[type],
        nextAction: extra.nextAction ?? ACTION_NEXT[type],
        dueDate: extra.dueDate ? extra.dueDate.toISOString() : null,
        overdueDays,
        href: `/variations/${row.id}${extra.hash ?? ''}`,
      });
    };

    // ── the notice, on its own track ────────────────────────────────────
    const notice = row.notices[0] ?? null;
    const noticeOverdue = row.noticeDueDate ? daysBetween(row.noticeDueDate, today) : null;

    if (row.noticeStatus === 'not_assessed') {
      push('notice_decision', {
        dueDate: row.noticeDueDate,
        overdueDays: noticeOverdue,
        hash: '#review',
      });
    } else if (row.noticeRequired && notice) {
      if (notice.status === 'draft') {
        push('notice_draft_not_sent', {
          dueDate: row.noticeDueDate,
          overdueDays: noticeOverdue,
          hash: '#notice',
        });
      } else if (notice.status === 'issued') {
        const failed = notice.notification?.status === 'failed';
        push(failed ? 'notice_delivery_failed' : 'notice_pending_delivery', {
          dueDate: row.noticeDueDate,
          overdueDays: noticeOverdue,
          // A failed delivery is red whatever the deadline says. From this
          // app's side the notice was sent, so nothing else will ever mention
          // it again — this row is the only place it surfaces.
          priority: failed ? 'red' : 'amber',
          hash: '#notice',
        });
      } else if (notice.status === 'sent' && !notice.acknowledgedAt) {
        push('notice_awaiting_acknowledgement', { priority: 'amber', hash: '#notice' });
      }
    } else if (row.noticeRequired && !notice && noticeOverdue !== null) {
      // Assessed as required and nothing written. The deadline decides.
      push(noticeOverdue >= 0 ? 'notice_overdue' : 'notice_due_soon', {
        dueDate: row.noticeDueDate,
        overdueDays: noticeOverdue,
        hash: '#notice',
      });
    }

    // ── the commercial chain ────────────────────────────────────────────
    const nextDue = row.nextActionDueDate ? daysBetween(row.nextActionDueDate, today) : null;

    if (row.currentStatus === 'qs_pricing' && nextDue !== null && nextDue >= 0) {
      push('qs_pricing_overdue', { dueDate: row.nextActionDueDate, overdueDays: nextDue });
    }

    if (
      ['internal_approval', 'cm_review'].includes(row.currentStatus) &&
      nextDue !== null &&
      nextDue >= 0
    ) {
      push('pm_approval_overdue', { dueDate: row.nextActionDueDate, overdueDays: nextDue });
    }

    if (row.currentStatus === 'needs_evidence') {
      // Two different questions wearing one status. The PM's "need more
      // information" writes what he asked for; anything else is evidence the
      // change is simply missing. Splitting them means the row tells the
      // engineer whether somebody is waiting on an answer or on a photograph.
      const type: ActionType = row.noticeMissingInformation
        ? 'clarification_required'
        : 'missing_evidence';
      push(type, {
        dueDate: row.nextActionDueDate,
        overdueDays: nextDue,
        ownerName: row.reportedBy?.fullName ?? row.currentOwner?.fullName ?? 'Unassigned',
        ownerUserId: row.reportedByUserId ?? row.currentOwnerUserId,
        nextAction: row.noticeMissingInformation
          ? `Answer: ${truncate(row.noticeMissingInformation, 60)}`
          : ACTION_NEXT.missing_evidence,
      });
    }

    if (isWorkStartedUnapproved({ workStatus: row.workStatus, currentStatus: row.currentStatus })) {
      push('work_started_unapproved', { priority: 'red' });
    }

    if (
      row.variationOrder &&
      isClientDecisionOverdue(
        {
          status: row.variationOrder.status,
          clientResponse: row.variationOrder.clientResponse,
          submittedAt: row.variationOrder.submittedAt,
        },
        responseDays.get(row.projectId) ?? 14,
        today,
      )
    ) {
      const waited = daysBetween(row.variationOrder.submittedAt!, today);
      push('client_response_overdue', {
        overdueDays: waited - (responseDays.get(row.projectId) ?? 14),
        ownerName: 'Client',
        ownerUserId: null,
        priority: 'red',
      });
    }

    const blockage = blockedByChange.get(row.id);
    if (blockage) {
      push('blocked', {
        overdueDays: blockage.overdueDays,
        priority: blockage.riskLevel === 'red' ? 'red' : blockage.riskLevel === 'amber' ? 'amber' : 'green',
        nextAction: blockage.blockerReason ?? ACTION_NEXT.blocked,
        ownerName: row.currentOwner?.fullName ?? blockage.blockedByRole ?? 'Unassigned',
      });
    }
  }

  /* ── project commercial position ──────────────────────────────────────── */

  const overdueByProject = new Map<string, number>();
  for (const action of actions) {
    if (action.priority !== 'red') continue;
    overdueByProject.set(action.projectId, (overdueByProject.get(action.projectId) ?? 0) + 1);
  }

  const positions: ProjectPosition[] = projects.map((project) => {
    const mine = rows.filter((row) => row.projectId === project.id);
    return {
      projectId: project.id,
      projectName: project.projectName,
      projectCode: project.projectCode,
      pendingValue: sum(
        mine
          .filter((row) =>
            isPendingChange({ currentStatus: row.currentStatus, clientResponse: row.clientResponse }),
          )
          .map((row) => row.value),
      ),
      // Agreed by the client and not yet applied for, read off the variation
      // order rather than recomputed: the same subtraction the commercial
      // position uses, so the table and the card cannot disagree.
      approvedNotInvoiced: sum(
        mine
          .filter((row) => row.variationOrder && ['approved', 'part_approved'].includes(row.variationOrder.status))
          .map((row) => Number(row.variationOrder!.approvedValue ?? 0)),
      ),
      workStartedUnapproved: sum(
        mine
          .filter((row) =>
            isWorkStartedUnapproved({ workStatus: row.workStatus, currentStatus: row.currentStatus }),
          )
          .map((row) => row.value),
      ),
      openChanges: mine.length,
      overdueActions: overdueByProject.get(project.id) ?? 0,
    };
  });

  return {
    persona,
    money: {
      pendingValue: sum(pending.map((row) => row.value)),
      pendingCount: pending.length,
      approvedNotInvoiced: Number(commercial.unbilledValue),
      approvedNotInvoicedCount: commercial.unbilledCount,
      workStartedValue: sum(started.map((row) => row.value)),
      workStartedCount: started.length,
      clientOverdueValue: sum(
        clientOverdue.map((row) => Number(row.variationOrder!.submittedValue ?? row.value)),
      ),
      clientOverdueCount: clientOverdue.length,
      clientOverdueOldestDays: clientOverdue.reduce(
        (max, row) => Math.max(max, daysBetween(row.variationOrder!.submittedAt!, today)),
        0,
      ),
    },
    actions: actionsForPersona(actions, persona),
    pipeline: buildPipeline(
      rows.map((row) => ({
        currentStatus: row.currentStatus,
        value: row.value,
        ageDays: row.ageDays,
        vo: row.voShape,
      })),
    ),
    projects: rankProjects(positions).filter(
      (row) => row.openChanges > 0 || row.pendingValue > 0 || row.approvedNotInvoiced > 0,
    ),
  };
}

/**
 * Who this person is, asked as four capability questions rather than a job
 * title — the same rule the work routing follows.
 *
 * Project roles are read across every project they sit on, because a PM on one
 * job and an observer on another is still a PM.
 */
export async function resolvePersona(user: AuthenticatedUser): Promise<Persona> {
  const memberships = await prisma.projectMember.findMany({
    where: { userId: user.id, active: true },
    select: { projectRole: true },
    distinct: ['projectRole'],
  });
  const roles = memberships.map((m) => m.projectRole);

  const [viewAllProjects, manageInvoices, assessNotice, submitPricing] = await Promise.all([
    hasCapability(user.systemRole, roles, 'project.viewAll'),
    hasCapability(user.systemRole, roles, 'invoice.manage'),
    hasCapability(user.systemRole, roles, 'potentialChange.assessNotice'),
    hasCapability(user.systemRole, roles, 'pricing.submit'),
  ]);

  return personaFor({ viewAllProjects, manageInvoices, assessNotice, submitPricing });
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
