import 'server-only';
import type { PotentialChangeStatus, Prisma, ProjectRole, TaskType } from '@prisma/client';
import { todayUtc } from '@/lib/dates';
import { pickResponsibleMember } from '@/services/permissions.service';
import { loadRecipients, recordTaskNotifications } from '@/services/notification.service';
import type { Capability } from '@/lib/rbac';

/**
 * Entering a stage.
 *
 * ── The hole this closes ───────────────────────────────────────────────────
 * Moving a change to a new status used to write one column and stop. No owner,
 * no next action, no task. So a change that two directors had just approved
 * arrived at QS pricing with `waitingFor` null, `nextAction` null and nothing
 * on anybody's list — visible only to someone who happened to open it. Osman
 * found it the way you always find this: "it didn't appear to the QS."
 *
 * A status is not a handover. A handover is a named person, a stated next
 * action, a date, and something on their list. All four, or the change is
 * quietly nobody's.
 *
 * ── Resolved by capability, never by job title ─────────────────────────────
 * Same rule as everywhere else in this codebase: ask who is PERMITTED to do
 * the work, not who has the matching role name. A null owner is honest and
 * shows as a bottleneck; a task parked on someone who cannot act is not.
 */

interface StageDefinition {
  capability: Capability;
  /** Seniority for this stage only. Ties between people who all hold it. */
  preferredRoles: ProjectRole[];
  taskType: TaskType;
  waitingFor: string;
  nextAction: string;
  dueDays: number;
}

const STAGES: Partial<Record<PotentialChangeStatus, StageDefinition>> = {
  notice_assessment: {
    capability: 'potentialChange.assessNotice',
    preferredRoles: ['commercial_manager', 'contract_administrator', 'project_manager'],
    taskType: 'notice_assessment',
    waitingFor: 'Notice assessment',
    nextAction: 'Assess whether a contractual notice is required',
    dueDays: 3,
  },
  qs_pricing: {
    capability: 'pricing.submit',
    preferredRoles: ['quantity_surveyor', 'commercial_manager'],
    taskType: 'qs_pricing',
    waitingFor: 'QS pricing',
    nextAction: 'Price the change and submit it for approval',
    dueDays: 5,
  },
};

/**
 * `internal_approval` is absent on purpose: that stage opens an approval gate,
 * which raises its own task per seat. Giving it a stage task as well would put
 * the same decision on somebody's list twice.
 *
 * `pm_scope_review` is absent since 2026-09-22, when the PM's notice decision
 * became the PM review. A change no longer stops twice for the same person:
 * they answer the notice question and it goes to the QS. The status value and
 * its label stay, because changes that stopped there before still read.
 */

export interface StageEntryResult {
  ownerUserId: string | null;
  taskCreated: boolean;
}

export async function enterStage(
  db: Prisma.TransactionClient,
  input: {
    potentialChangeId: string;
    projectId: string;
    pcNumber: string;
    title: string;
    status: PotentialChangeStatus;
    actorUserId: string;
    /** Context for the message, e.g. why it came back. */
    note?: string;
  },
): Promise<StageEntryResult> {
  const stage = STAGES[input.status];

  if (!stage) {
    // A terminal or gated stage. Clear the "waiting for" so a finished change
    // does not go on claiming it is waiting for something.
    if (
      input.status === 'variation_approved' ||
      input.status === 'included_scope' ||
      input.status === 'cancelled'
    ) {
      await db.potentialChange.update({
        where: { id: input.potentialChangeId },
        data: { waitingFor: null, nextAction: null, nextActionDueDate: null },
      });
    }
    return { ownerUserId: null, taskCreated: false };
  }

  const owner = await pickResponsibleMember(
    input.projectId,
    stage.capability,
    stage.preferredRoles,
  );

  const due = new Date(todayUtc());
  due.setUTCDate(due.getUTCDate() + stage.dueDays);

  await db.potentialChange.update({
    where: { id: input.potentialChangeId },
    data: {
      currentOwnerUserId: owner,
      waitingFor: stage.waitingFor,
      nextAction: input.note ? `${stage.nextAction}. ${input.note}` : stage.nextAction,
      nextActionDueDate: due,
    },
  });

  return raiseStageTask(db, input);
}

/**
 * The task half of a handover, without the headline.
 *
 * `enterStage` claims the change: owner, waiting-for, next action, date. That
 * is right when the stage IS what the change is waiting for. It is wrong when
 * two things run at once — a QS pricing in parallel with information the PM is
 * still chasing — because the louder of the two would overwrite the other and
 * the register would stop saying what is actually outstanding.
 *
 * So this raises the task, resolves its owner and tells them, and leaves the
 * change row alone. Same dedupe guard, same notification.
 */
export async function raiseStageTask(
  db: Prisma.TransactionClient,
  input: {
    potentialChangeId: string;
    projectId: string;
    pcNumber: string;
    title: string;
    status: PotentialChangeStatus;
    actorUserId: string;
    note?: string;
  },
): Promise<StageEntryResult> {
  const stage = STAGES[input.status];
  if (!stage) return { ownerUserId: null, taskCreated: false };

  const owner = await pickResponsibleMember(
    input.projectId,
    stage.capability,
    stage.preferredRoles,
  );

  const due = new Date(todayUtc());
  due.setUTCDate(due.getUTCDate() + stage.dueDays);

  // Never a second task for work already on someone's list. Moving a change
  // back and forward between two stages would otherwise leave a trail of
  // duplicates, each being chased daily.
  const open = await db.task.findFirst({
    where: {
      potentialChangeId: input.potentialChangeId,
      taskType: stage.taskType,
      status: { in: ['open', 'in_progress'] },
    },
    select: { id: true },
  });
  if (open) return { ownerUserId: owner, taskCreated: false };

  const task = await db.task.create({
    data: {
      projectId: input.projectId,
      potentialChangeId: input.potentialChangeId,
      taskType: stage.taskType,
      title: `${stage.waitingFor} — ${input.pcNumber}`,
      description: input.note ? `${input.title}. ${input.note}` : input.title,
      assignedToUserId: owner,
      assignedByUserId: input.actorUserId,
      dueDate: due,
    },
  });

  if (owner) {
    const recipients = await loadRecipients([owner]);
    await recordTaskNotifications(db, {
      taskId: task.id,
      potentialChangeId: input.potentialChangeId,
      kind: 'task_assigned',
      subject: `${stage.waitingFor} — ${input.pcNumber}`,
      body: `${input.title}. ${stage.nextAction}.${input.note ? ` ${input.note}` : ''}`,
      on: todayUtc(),
      recipients,
    });
  }

  return { ownerUserId: owner, taskCreated: true };
}
