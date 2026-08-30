import 'server-only';
import type { EscalationLevel } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formatDate, isWorkingDay, todayUtc, workingDaysBetween } from '@/lib/dates';
import {
  dispatchPendingNotifications,
  recordTaskNotifications,
  type NotificationRecipient,
} from '@/services/notification.service';

/**
 * The chase.
 *
 * A task is the app naming who owes a decision. This is the app going on
 * saying so until the decision is made, and widening the audience when it is
 * not. Without it a task is a note in a drawer.
 *
 * ── Where it stops ─────────────────────────────────────────────────────────
 * Completed, cancelled, or the project is no longer running. Those are the
 * only exits, and they are expressed as the QUERY rather than as checks in a
 * loop, so there is no path that keeps chasing a closed task by accident.
 * Cancelling a task is how an administrator calls off a chase; the task keeps
 * its history rather than being deleted.
 *
 * ── The ladder ─────────────────────────────────────────────────────────────
 *   on time            the person who owes the decision
 *   1 working day late + the project managers
 *   3 working days     + the managing director
 *   5 working days     the same audience, now marked critical
 *
 * Widening rather than handing over: the decision stays with the person who
 * owes it, and their PM is copied so somebody senior knows it is stuck. A
 * ladder that reassigns instead teaches people that ignoring a task moves it
 * off their desk.
 *
 * ── Weekends ───────────────────────────────────────────────────────────────
 * No chasing on non-working days, WITH ONE EXCEPTION: a notice deadline that
 * falls today or has already passed is chased regardless. The working week is
 * an administrative convenience. A contractual deadline is not, and it does
 * not pause for a Saturday.
 */

const ESCALATION_AT_WORKING_DAYS: { days: number; level: EscalationLevel }[] = [
  { days: 5, level: 'level_3' },
  { days: 3, level: 'level_2' },
  { days: 1, level: 'level_1' },
];

/** Projects that are not being delivered do not generate chasing. */
const LIVE_PROJECT_STATUSES = ['tender', 'awarded', 'active'] as const;

function levelFor(workingDaysLate: number): EscalationLevel {
  return ESCALATION_AT_WORKING_DAYS.find((step) => workingDaysLate >= step.days)?.level ?? 'none';
}

function rank(level: EscalationLevel): number {
  return { none: 0, level_1: 1, level_2: 2, level_3: 3 }[level];
}

export interface ReminderSweepResult {
  examined: number;
  remindersWritten: number;
  escalationsRaised: number;
  queuedForDelivery: number;
  skippedNonWorkingDay: boolean;
}

export async function runReminderSweep(now: Date = new Date()): Promise<ReminderSweepResult> {
  const today = todayUtc(now);

  const settings = await prisma.companySettings.findFirst({
    select: { workweekStartDay: true, workweekEndDay: true },
  });
  const weekStart = settings?.workweekStartDay ?? 1;
  const weekEnd = settings?.workweekEndDay ?? 5;
  const workingToday = isWorkingDay(today, weekStart, weekEnd);

  const tasks = await prisma.task.findMany({
    where: {
      status: { in: ['open', 'in_progress', 'blocked'] },
      assignedToUserId: { not: null },
      assignedTo: { active: true },
      project: { projectStatus: { in: [...LIVE_PROJECT_STATUSES] } },
    },
    include: {
      assignedTo: { select: { id: true, fullName: true, email: true, phone: true } },
      project: { select: { id: true, projectCode: true, projectName: true } },
      potentialChange: { select: { id: true, pcNumber: true, title: true, noticeDueDate: true } },
    },
  });

  let remindersWritten = 0;
  let escalationsRaised = 0;
  let examined = 0;

  for (const task of tasks) {
    if (!task.assignedTo) continue;

    const noticeDue = task.potentialChange?.noticeDueDate ?? null;
    const noticeCritical = noticeDue !== null && noticeDue.getTime() <= today.getTime();

    // The weekend rule, and its one exception.
    if (!workingToday && !noticeCritical) continue;
    examined++;

    const lateBy = task.dueDate
      ? workingDaysBetween(task.dueDate, today, weekStart, weekEnd)
      : 0;
    const level = noticeCritical && task.dueDate ? maxLevel(levelFor(lateBy), 'level_2') : levelFor(lateBy);

    const recipients = await resolveAudience(task.project.id, task.assignedTo, level);

    const pc = task.potentialChange;
    const reference = pc ? `${pc.pcNumber} — ${pc.title}` : task.title;
    const due = task.dueDate ? formatDate(task.dueDate) : 'no date set';

    const subject =
      level === 'none'
        ? `Waiting on you: ${task.title}`
        : `${lateBy} working day${lateBy === 1 ? '' : 's'} late: ${task.title}`;

    const body = [
      `${task.assignedTo.fullName} owes a decision on ${reference}.`,
      `Project ${task.project.projectCode} — ${task.project.projectName}.`,
      `Due ${due}.`,
      noticeDue
        ? noticeCritical
          ? `THE CONTRACTUAL NOTICE DEADLINE (${formatDate(noticeDue)}) HAS BEEN REACHED.`
          : `Contractual notice deadline ${formatDate(noticeDue)}.`
        : null,
      level === 'none' ? null : 'Copied to project management because it is overdue.',
    ]
      .filter(Boolean)
      .join(' ');

    const written = await prisma.$transaction((tx) =>
      recordTaskNotifications(tx, {
        taskId: task.id,
        potentialChangeId: task.potentialChangeId,
        kind: level === 'none' ? 'task_reminder' : 'task_escalation',
        escalationLevel: level,
        subject,
        body,
        on: today,
        recipients,
      }),
    );

    remindersWritten += written;

    if (rank(level) > rank(task.escalationLevel)) {
      escalationsRaised++;
      await prisma.task.update({ where: { id: task.id }, data: { escalationLevel: level } });
    }
  }

  // Sending is the dispatcher's job, and it happens after every row is safely
  // written. A crash here loses a send, not a record of one that is owed.
  const delivery = await dispatchPendingNotifications();

  return {
    examined,
    remindersWritten,
    escalationsRaised,
    queuedForDelivery: delivery.queued,
    skippedNonWorkingDay: !workingToday,
  };
}

function maxLevel(a: EscalationLevel, b: EscalationLevel): EscalationLevel {
  return rank(a) >= rank(b) ? a : b;
}

/**
 * Who hears about it at this level.
 *
 * Deduplicated by user id, because a project manager who is also the assignee
 * should be told once. Being chased twice for one decision reads as a broken
 * system, and it is.
 */
async function resolveAudience(
  projectId: string,
  assignee: { id: string; fullName: string; email: string; phone: string | null },
  level: EscalationLevel,
): Promise<NotificationRecipient[]> {
  const audience = new Map<string, NotificationRecipient>();
  audience.set(assignee.id, {
    userId: assignee.id,
    fullName: assignee.fullName,
    email: assignee.email,
    phone: assignee.phone,
  });

  if (rank(level) >= 1) {
    const managers = await prisma.projectMember.findMany({
      where: { projectId, active: true, projectRole: 'project_manager', user: { active: true } },
      select: { user: { select: { id: true, fullName: true, email: true, phone: true } } },
    });
    for (const { user } of managers) {
      audience.set(user.id, {
        userId: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
      });
    }
  }

  if (rank(level) >= 2) {
    // Company-wide, not a project membership: a managing director is normally
    // on no project at all, which is the whole reason this is a system role.
    const directors = await prisma.user.findMany({
      where: { active: true, systemRole: 'managing_director' },
      select: { id: true, fullName: true, email: true, phone: true },
    });
    for (const director of directors) {
      audience.set(director.id, {
        userId: director.id,
        fullName: director.fullName,
        email: director.email,
        phone: director.phone,
      });
    }
  }

  return [...audience.values()];
}
