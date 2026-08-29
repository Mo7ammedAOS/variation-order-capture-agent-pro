import 'server-only';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { NotFoundError } from '@/lib/errors';
import { todayUtc } from '@/lib/dates';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit } from '@/services/audit-log.service';
import { assertProjectAccess, scopeToUser } from '@/services/project-access.service';

export const taskCreateSchema = z.object({
  projectId: z.string().uuid(),
  potentialChangeId: z.string().uuid().optional().nullable(),
  taskType: z.enum([
    'notice_assessment', 'pm_scope_review', 'qs_pricing', 'procurement_quotation',
    'subcontractor_quotation', 'eot_assessment', 'cm_review', 'internal_approval',
    'evidence_collection', 'client_follow_up', 'document_request', 'other',
  ]),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  assignedToUserId: z.string().uuid().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
});

export async function listTasks(
  user: AuthenticatedUser,
  filters: { projectId?: string; assignedToUserId?: string; status?: string } = {},
) {
  const scope = await scopeToUser(user);
  const where: Prisma.TaskWhereInput = { ...scope };

  if (filters.projectId) {
    await assertProjectAccess(user, filters.projectId);
    where.projectId = filters.projectId;
  }
  if (filters.assignedToUserId) where.assignedToUserId = filters.assignedToUserId;
  if (filters.status) where.status = filters.status as Prisma.EnumTaskStatusFilter['equals'];

  return prisma.task.findMany({
    where,
    orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }],
    include: {
      project: { select: { id: true, projectCode: true, projectName: true } },
      potentialChange: { select: { id: true, pcNumber: true, title: true, estimatedValue: true, riskLevel: true } },
      assignedTo: { select: { id: true, fullName: true } },
    },
  });
}

/**
 * The My Tasks view. Sorted the way someone triaging their morning actually
 * wants it: what is late, then what is due, then what is worth the most.
 */
export async function getMyTasks(user: AuthenticatedUser) {
  const today = todayUtc();

  const tasks = await prisma.task.findMany({
    where: { assignedToUserId: user.id, status: { in: ['open', 'in_progress', 'blocked'] } },
    include: {
      project: { select: { id: true, projectCode: true, projectName: true } },
      potentialChange: {
        select: { id: true, pcNumber: true, title: true, estimatedValue: true, riskLevel: true, noticeDueDate: true },
      },
    },
  });

  const priorityRank = { critical: 3, high: 2, normal: 1, low: 0 } as const;

  const sorted = [...tasks].sort((a, b) => {
    const aOverdue = a.dueDate !== null && a.dueDate < today;
    const bOverdue = b.dueDate !== null && b.dueDate < today;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

    if (priorityRank[a.priority] !== priorityRank[b.priority]) {
      return priorityRank[b.priority] - priorityRank[a.priority];
    }

    const aDue = a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
    const bDue = b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;

    return Number(b.potentialChange?.estimatedValue ?? 0) - Number(a.potentialChange?.estimatedValue ?? 0);
  });

  return {
    dueToday: sorted.filter((t) => t.dueDate !== null && sameDay(t.dueDate, today)),
    overdue: sorted.filter((t) => t.dueDate !== null && t.dueDate < today),
    upcoming: sorted.filter((t) => t.dueDate === null || t.dueDate > today),
    all: sorted,
  };
}

export async function createTask(user: AuthenticatedUser, input: z.infer<typeof taskCreateSchema>) {
  await assertProjectAccess(user, input.projectId, 'task.assign');

  return prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: { ...input, assignedByUserId: user.id },
    });
    await recordAudit({
      db: tx,
      projectId: input.projectId,
      userId: user.id,
      recordType: 'task',
      recordId: task.id,
      actionType: 'assigned',
      newValue: { title: task.title, assignedToUserId: task.assignedToUserId, dueDate: task.dueDate },
    });
    return task;
  });
}

export const taskUpdateSchema = z.object({
  status: z.enum(['open', 'in_progress', 'blocked', 'completed', 'cancelled']).optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
});

export async function updateTask(
  user: AuthenticatedUser,
  taskId: string,
  input: z.infer<typeof taskUpdateSchema>,
) {
  const existing = await prisma.task.findUnique({ where: { id: taskId } });
  if (!existing) throw new NotFoundError('Task not found');

  // Completing your own task needs only `task.complete`; reassigning someone
  // else's needs `task.assign`. Those are different powers.
  const capability =
    input.assignedToUserId !== undefined && input.assignedToUserId !== existing.assignedToUserId
      ? 'task.assign'
      : 'task.complete';
  await assertProjectAccess(user, existing.projectId, capability);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        ...input,
        completedAt: input.status === 'completed' ? new Date() : existing.completedAt,
      },
    });

    await recordAudit({
      db: tx,
      projectId: existing.projectId,
      userId: user.id,
      recordType: 'task',
      recordId: taskId,
      actionType: input.status === 'completed' ? 'completed' : 'updated',
      oldValue: { status: existing.status, assignedToUserId: existing.assignedToUserId },
      newValue: { status: updated.status, assignedToUserId: updated.assignedToUserId },
    });

    return updated;
  });
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}
