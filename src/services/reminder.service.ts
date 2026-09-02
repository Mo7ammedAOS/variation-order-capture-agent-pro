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

  // Approval rows, looked up separately and joined by task id.
  //
  // `Task` has no back-relation to `Approval` and does not need one: this is
  // one small query, and a schema change to save it would be a migration paid
  // for by nothing.
  const approvals = await prisma.approval.findMany({
    where: { potentialChange: { project: { projectStatus: { in: [...LIVE_PROJECT_STATUSES] } } } },
    select: {
      taskId: true,
      decision: true,
      gate: true,
      seat: true,
      round: true,
      potentialChangeId: true,
    },
  });

  const approvalByTask = new Map(
    approvals.filter((row) => row.taskId).map((row) => [row.taskId as string, row]),
  );

  // Which seats have already said yes, so the managing director is only
  // chased once the ball is actually with him.
  const approvedSeats = new Set(
    approvals
      .filter((row) => row.decision === 'approved')
      .map((row) => `${row.potentialChangeId}:${row.gate}:${row.round}:${row.seat}`),
  );

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

    // An approval task answers to its seat, not to the general ladder.
    const approval = approvalByTask.get(task.id);
    const chase = approval
      ? approvalChase({
          gate: approval.gate,
          seat: approval.seat,
          waitingDays: lateBy,
          otherSeatApproved: approvedSeats.has(
            `${approval.potentialChangeId}:${approval.gate}:${approval.round}:` +
              `${approval.seat === 'project_manager' ? 'managing_director' : 'project_manager'}`,
          ),
        })
      : { chase: true, widen: true };

    // Quiet is a decision, not an omission. The managing director is not asked
    // about a notice for the first three days because the project manager owns
    // that call, and a director copied on every decision from hour one stops
    // reading any of them.
    if (!chase.chase && !noticeCritical) continue;

    const level = noticeCritical && task.dueDate
      ? maxLevel(levelFor(lateBy), 'level_2')
      : chase.widen
        ? levelFor(lateBy)
        : 'none';

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

/** How long the managing director is left alone before a notice is chased. */
const MD_NOTICE_GRACE_DAYS = 3;

/**
 * How hard to chase one seat of one gate, and whether to widen the audience.
 *
 * Osman's rules, 2026-09-02, and each one has a reason:
 *
 *   Notice, project manager   chased EVERY DAY, and never widened. It is his
 *                             decision, the clock is running, and copying his
 *                             director on day one is how you teach a director
 *                             to ignore the mail.
 *   Notice, managing director quiet for three days, then daily. He is the
 *                             backstop for a PM who has gone quiet, not the
 *                             first line.
 *   Money, project manager    chased daily. Nothing moves without him.
 *   Money, managing director  quiet until the PM has approved. Before that the
 *                             ball is not with him, and chasing a man for a
 *                             decision he cannot yet make is noise.
 *
 * `widen` stays false throughout: these seats ARE the escalation. There is
 * nobody above a managing director to copy.
 */
export function approvalChase(input: {
  gate: 'notice_issue' | 'final_variation';
  seat: 'project_manager' | 'managing_director';
  waitingDays: number;
  otherSeatApproved: boolean;
}): { chase: boolean; widen: boolean } {
  if (input.seat === 'project_manager') return { chase: true, widen: false };

  if (input.gate === 'notice_issue') {
    return { chase: input.waitingDays >= MD_NOTICE_GRACE_DAYS, widen: false };
  }

  return { chase: input.otherSeatApproved, widen: false };
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
