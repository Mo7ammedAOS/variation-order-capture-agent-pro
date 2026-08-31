import 'server-only';
import type { ApprovalGate, ApprovalSeat, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { todayUtc } from '@/lib/dates';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit } from '@/services/audit-log.service';
import { assertProjectAccess, getProjectRoles } from '@/services/project-access.service';
import { hasCapability, listMembersWithCapability } from '@/services/permissions.service';
import { loadRecipients, recordTaskNotifications } from '@/services/notification.service';
import { enterStage } from '@/services/stage.service';
import { issueNotice, supersedeDraft } from '@/services/notice-document.service';
import type { Capability } from '@/lib/rbac';

/**
 * Two gates, two seats each, and nothing else gated.
 *
 *   notice_issue      before the initial notice of variation reaches the
 *                     client. It starts a contractual clock and states a
 *                     position, so it is not one person's call.
 *   final_variation   after the price exists. It commits to a number.
 *
 * ── Seats, not a list of approvers ─────────────────────────────────────────
 * A gate needs one operational decision and one commercial one. Requiring
 * every project manager to approve stalls a project that has two of them;
 * requiring "any one approval from a pool" would let the same person answer
 * for both sides, which is not two approvals at all. So each gate has exactly
 * two seats, and the same person may never fill both — enforced here rather
 * than left to the interface.
 *
 * ── Who may sit in a seat is the admin's decision ──────────────────────────
 * Not a hardcoded role name. That mistake put a notice assessment on a project
 * manager the app then refused, so seats resolve through the permission matrix
 * exactly as buttons do.
 *
 * ── Rejection is recoverable, and permanent ────────────────────────────────
 * A rejection sends the change back a stage with a required reason. The
 * rejected round is never deleted or overwritten: resubmitting opens round 2.
 * Erasing a "no" would leave a file that cannot explain its own history, which
 * is the file you have to produce when the decision is challenged.
 */

const SEAT_CAPABILITY: Record<ApprovalSeat, Capability> = {
  project_manager: 'approval.projectManager',
  managing_director: 'approval.managingDirector',
};

const SEAT_LABEL: Record<ApprovalSeat, string> = {
  project_manager: 'Project manager',
  managing_director: 'Managing director',
};

export const GATE_LABEL: Record<ApprovalGate, string> = {
  notice_issue: 'Issue the notice to the client',
  final_variation: 'Final variation approval',
};

const SEATS: ApprovalSeat[] = ['project_manager', 'managing_director'];

export const approvalDecisionSchema = z
  .object({
    approvalId: z.string().uuid(),
    decision: z.enum(['approved', 'rejected']),
    comment: z.string().trim().max(2000).optional(),
  })
  // A rejection without a reason cannot be acted on by the person who has to
  // fix it, and months later it cannot be explained to anybody either.
  .refine((value) => value.decision !== 'rejected' || (value.comment?.length ?? 0) >= 3, {
    message: 'Say why you are rejecting it. The person who has to fix it needs the reason.',
    path: ['comment'],
  });

export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;

/**
 * Opens a gate: one row per seat, plus a task each so the existing chase
 * machinery reminds them daily and escalates on its own.
 *
 * Idempotent by the unique index on (change, gate, seat, round) — opening a
 * gate that is already open changes nothing.
 */
export async function openGate(
  db: Prisma.TransactionClient,
  input: {
    potentialChangeId: string;
    projectId: string;
    gate: ApprovalGate;
    pcNumber: string;
    title: string;
    round?: number;
    dueDate: Date;
    openedByUserId: string;
  },
): Promise<void> {
  const round = input.round ?? 1;

  for (const seat of SEATS) {
    const holders = await listMembersWithCapability(input.projectId, SEAT_CAPABILITY[seat]);
    // The first holder by seniority of assignment. Null is allowed and
    // deliberate: a seat nobody can fill must be VISIBLE, not silently absent.
    const assignee = holders[0]?.userId ?? (await companyWideHolder(seat));

    const existing = await db.approval.findFirst({
      where: { potentialChangeId: input.potentialChangeId, gate: input.gate, seat, round },
      select: { id: true },
    });
    if (existing) continue;

    const task = await db.task.create({
      data: {
        projectId: input.projectId,
        potentialChangeId: input.potentialChangeId,
        taskType: 'internal_approval',
        title: `${GATE_LABEL[input.gate]} — ${input.pcNumber}`,
        description: `${SEAT_LABEL[seat]} approval for "${input.title}".`,
        assignedToUserId: assignee,
        assignedByUserId: input.openedByUserId,
        dueDate: input.dueDate,
        priority: 'high',
      },
    });

    await db.approval.create({
      data: {
        projectId: input.projectId,
        potentialChangeId: input.potentialChangeId,
        gate: input.gate,
        seat,
        round,
        assignedToUserId: assignee,
        taskId: task.id,
      },
    });

    if (assignee) {
      const recipients = await loadRecipients([assignee]);
      await recordTaskNotifications(db, {
        taskId: task.id,
        potentialChangeId: input.potentialChangeId,
        kind: 'task_assigned',
        subject: `Approval needed — ${input.pcNumber}`,
        body: `${GATE_LABEL[input.gate]}: ${input.title}. Your approval as ${SEAT_LABEL[seat].toLowerCase()} is required.`,
        on: todayUtc(),
        recipients,
      });
    }
  }
}

/** A managing director sits on no project, so the seat looks company-wide. */
async function companyWideHolder(seat: ApprovalSeat): Promise<string | null> {
  const capability = SEAT_CAPABILITY[seat];
  const grants = await prisma.rolePermission.findMany({
    where: { scope: 'system', capability, granted: true },
    select: { role: true },
  });
  if (grants.length === 0) return null;

  const holder = await prisma.user.findFirst({
    where: { active: true, systemRole: { in: grants.map((g) => g.role) as never } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return holder?.id ?? null;
}

export interface GateState {
  gate: ApprovalGate;
  round: number;
  seats: {
    id: string;
    seat: ApprovalSeat;
    seatLabel: string;
    decision: 'pending' | 'approved' | 'rejected';
    assignedToName: string | null;
    decidedByName: string | null;
    decidedAt: Date | null;
    comment: string | null;
  }[];
  complete: boolean;
  rejected: boolean;
}

export async function getGateState(
  potentialChangeId: string,
  gate: ApprovalGate,
): Promise<GateState | null> {
  const rows = await prisma.approval.findMany({
    where: { potentialChangeId, gate },
    orderBy: [{ round: 'desc' }, { seat: 'asc' }],
    include: {
      assignedTo: { select: { fullName: true } },
      decidedBy: { select: { fullName: true } },
    },
  });
  if (rows.length === 0) return null;

  const round = rows[0]?.round ?? 1;
  const current = rows.filter((row) => row.round === round);

  return {
    gate,
    round,
    seats: current.map((row) => ({
      id: row.id,
      seat: row.seat,
      seatLabel: SEAT_LABEL[row.seat],
      decision: row.decision,
      assignedToName: row.assignedTo?.fullName ?? null,
      decidedByName: row.decidedBy?.fullName ?? null,
      decidedAt: row.decidedAt,
      comment: row.comment,
    })),
    complete: current.every((row) => row.decision === 'approved'),
    rejected: current.some((row) => row.decision === 'rejected'),
  };
}

/** Whether this person may fill this particular seat. */
export async function canFillSeat(
  user: AuthenticatedUser,
  projectId: string,
  seat: ApprovalSeat,
): Promise<boolean> {
  const projectRoles = await getProjectRoles(user, projectId);
  return hasCapability(user.systemRole, projectRoles, SEAT_CAPABILITY[seat]);
}

export interface DecisionResult {
  gate: ApprovalGate;
  complete: boolean;
  rejected: boolean;
  movedTo: string | null;
  /**
   * Set when this decision issued a notice. The caller files its PDF AFTER the
   * transaction has committed — a Drive round trip inside a Prisma interactive
   * transaction times out at five seconds, and that already cost this project
   * a duplicated folder tree once.
   */
  noticeToFileId?: string;
}

export async function recordApprovalDecision(
  user: AuthenticatedUser,
  input: ApprovalDecisionInput,
): Promise<DecisionResult> {
  const parsed = approvalDecisionSchema.parse(input);

  const approval = await prisma.approval.findUnique({
    where: { id: parsed.approvalId },
    include: {
      potentialChange: { select: { id: true, pcNumber: true, title: true, currentStatus: true } },
    },
  });
  if (!approval) throw new NotFoundError('Approval not found');

  await assertProjectAccess(user, approval.projectId);

  if (approval.decision !== 'pending') {
    throw new ValidationError('That approval has already been decided.');
  }
  if (!(await canFillSeat(user, approval.projectId, approval.seat))) {
    throw new ForbiddenError(`You do not hold the ${SEAT_LABEL[approval.seat].toLowerCase()} approval.`);
  }

  // One person, one seat. Without this a project manager who is also acting
  // director signs both halves and the gate means nothing.
  const alreadyDecidedHere = await prisma.approval.findFirst({
    where: {
      potentialChangeId: approval.potentialChangeId,
      gate: approval.gate,
      round: approval.round,
      decidedByUserId: user.id,
    },
    select: { id: true },
  });
  if (alreadyDecidedHere) {
    throw new ForbiddenError('You have already given one of the two approvals on this gate.');
  }

  return prisma.$transaction(async (tx) => {
    await tx.approval.update({
      where: { id: approval.id },
      data: {
        decision: parsed.decision,
        decidedByUserId: user.id,
        decidedAt: new Date(),
        comment: parsed.comment ?? null,
      },
    });

    if (approval.taskId) {
      await tx.task.updateMany({
        where: { id: approval.taskId, status: { in: ['open', 'in_progress'] } },
        data: { status: 'completed', completedAt: new Date() },
      });
    }

    const siblings = await tx.approval.findMany({
      where: {
        potentialChangeId: approval.potentialChangeId,
        gate: approval.gate,
        round: approval.round,
      },
      select: { id: true, decision: true, taskId: true },
    });

    const rejected = siblings.some((row) => row.decision === 'rejected');
    const complete = !rejected && siblings.every((row) => row.decision === 'approved');

    let movedTo: string | null = null;
    let noticeToFileId: string | undefined;

    if (rejected) {
      // Back a stage, never cancelled. A rejection is usually "not like this",
      // and cancelling would throw away the entitlement with the change.
      movedTo = approval.gate === 'notice_issue' ? 'notice_assessment' : 'qs_pricing';

      if (approval.gate === 'notice_issue') {
        // The rejected wording is retired whole, and the change goes back to
        // needing a notice. Editing the rejected draft in place would leave a
        // file that cannot explain why it says what it says.
        await supersedeDraft(tx, {
          potentialChangeId: approval.potentialChangeId,
          projectId: approval.projectId,
          actorUserId: user.id,
        });
      }

      // The other seat is no longer being asked: close its task rather than
      // leave someone chased daily for a decision that no longer matters.
      for (const sibling of siblings) {
        if (sibling.id !== approval.id && sibling.taskId) {
          await tx.task.updateMany({
            where: { id: sibling.taskId, status: { in: ['open', 'in_progress'] } },
            data: { status: 'cancelled' },
          });
        }
      }
    } else if (complete) {
      movedTo = approval.gate === 'notice_issue' ? 'pm_scope_review' : 'variation_approved';

      if (approval.gate === 'notice_issue') {
        // Freeze the text and queue the message. It is not sent here, and it
        // does not become "sent" until the courier reports back.
        const issued = await issueNotice(tx, {
          potentialChangeId: approval.potentialChangeId,
          projectId: approval.projectId,
          actorUserId: user.id,
        });
        noticeToFileId = issued?.id;
      }
    }

    if (movedTo) {
      await tx.potentialChange.update({
        where: { id: approval.potentialChangeId },
        data: {
          currentStatus: movedTo as never,
          // The price is now agreed, so it stops being editable at all.
          ...(movedTo === 'variation_approved' ? { pricingStatus: 'approved' as const } : {}),
        },
      });

      // Then hand it over properly.
      //
      // This used to set `waitingFor` and `nextAction` to null on success,
      // which was worse than saying nothing: a change that two directors had
      // just approved arrived at the next stage owned by nobody, with no task
      // and no next action, visible only to whoever thought to open it. Osman
      // found it the way this is always found — "it didn't appear to the QS".
      await enterStage(tx, {
        potentialChangeId: approval.potentialChangeId,
        projectId: approval.projectId,
        pcNumber: approval.potentialChange.pcNumber,
        title: approval.potentialChange.title,
        status: movedTo as never,
        actorUserId: user.id,
        note: rejected
          ? `Rejected by ${user.fullName}: ${parsed.comment ?? 'no reason given'}`
          : undefined,
      });
    }

    await recordAudit({
      db: tx,
      projectId: approval.projectId,
      userId: user.id,
      recordType: 'approval',
      recordId: approval.id,
      actionType: parsed.decision === 'approved' ? 'approved' : 'rejected',
      newValue: {
        gate: approval.gate,
        seat: approval.seat,
        round: approval.round,
        comment: parsed.comment ?? null,
        movedTo,
      },
    });

    return { gate: approval.gate, complete, rejected, movedTo, noticeToFileId };
  });
}
