import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A gate is only worth having if it cannot be walked around.
 *
 * Four things have to hold, and each of them is a way the gate could look like
 * it works while meaning nothing:
 *
 *   · one approval is not two
 *   · the same person cannot supply both of them
 *   · a rejection sends the change BACK, it does not cancel it
 *   · a rejection without a reason is not a decision anyone can act on
 */

const state = {
  approval: null as Record<string, unknown> | null,
  siblings: [] as Record<string, unknown>[],
  alreadyDecidedByUser: null as Record<string, unknown> | null,
  canFill: true,
  pcUpdates: [] as Record<string, unknown>[],
  taskUpdates: [] as Record<string, unknown>[],
  approvalUpdates: [] as Record<string, unknown>[],
};

vi.mock('server-only', () => ({}));
vi.mock('@/services/audit-log.service', () => ({ recordAudit: async () => ({}) }));
vi.mock('@/services/project-access.service', () => ({
  assertProjectAccess: async () => undefined,
  getProjectRoles: async () => ['project_manager'],
}));
vi.mock('@/services/permissions.service', () => ({
  hasCapability: async () => state.canFill,
  listMembersWithCapability: async () => [],
}));
vi.mock('@/services/notification.service', () => ({
  loadRecipients: async () => [],
  recordTaskNotifications: async () => 0,
}));

const prismaMock = {
  approval: {
    findUnique: async () => state.approval,
    findFirst: async () => state.alreadyDecidedByUser,
    findMany: async () => state.siblings,
    update: async (args: Record<string, unknown>) => {
      state.approvalUpdates.push(args);
      return args;
    },
    create: async (args: Record<string, unknown>) => args,
  },
  task: {
    updateMany: async (args: Record<string, unknown>) => {
      state.taskUpdates.push(args);
      return { count: 1 };
    },
    create: async () => ({ id: 'task-new' }),
  },
  potentialChange: {
    update: async (args: Record<string, unknown>) => {
      state.pcUpdates.push(args);
      return args;
    },
  },
  rolePermission: { findMany: async () => [] },
  user: { findFirst: async () => null },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
};
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const { recordApprovalDecision, approvalDecisionSchema } = await import(
  '@/services/approval.service'
);

const USER = { id: 'pm-1', fullName: 'Daniel Okafor', systemRole: 'standard_user' } as never;
const ID = '11111111-1111-4111-8111-111111111111';

function approval(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    projectId: 'proj-1',
    potentialChangeId: 'pc-1',
    gate: 'notice_issue',
    seat: 'project_manager',
    round: 1,
    decision: 'pending',
    taskId: 'task-1',
    potentialChange: { id: 'pc-1', pcNumber: 'PC-1', currentStatus: 'notice_required' },
    ...overrides,
  };
}

describe('the two-seat approval gate', () => {
  beforeEach(() => {
    state.approval = approval();
    state.siblings = [];
    state.alreadyDecidedByUser = null;
    state.canFill = true;
    state.pcUpdates = [];
    state.taskUpdates = [];
    state.approvalUpdates = [];
  });

  it('does not move the change on a single approval', async () => {
    state.siblings = [
      { id: ID, decision: 'approved', taskId: 'task-1' },
      { id: 'other', decision: 'pending', taskId: 'task-2' },
    ];

    const result = await recordApprovalDecision(USER, { approvalId: ID, decision: 'approved' });

    expect(result.complete).toBe(false);
    expect(result.movedTo).toBeNull();
    expect(state.pcUpdates).toHaveLength(0);
  });

  it('releases the notice only when both seats have approved', async () => {
    state.siblings = [
      { id: ID, decision: 'approved', taskId: 'task-1' },
      { id: 'other', decision: 'approved', taskId: 'task-2' },
    ];

    const result = await recordApprovalDecision(USER, { approvalId: ID, decision: 'approved' });

    expect(result.complete).toBe(true);
    expect(result.movedTo).toBe('pm_scope_review');
  });

  // Without this the acting director approves as project manager AND as
  // director, and two approvals are one person nodding twice.
  it('refuses a second seat to somebody who already filled one', async () => {
    state.alreadyDecidedByUser = { id: 'other' };

    await expect(
      recordApprovalDecision(USER, { approvalId: ID, decision: 'approved' }),
    ).rejects.toThrow(/already given one of the two approvals/i);
  });

  it('refuses anyone who does not hold that seat', async () => {
    state.canFill = false;

    await expect(
      recordApprovalDecision(USER, { approvalId: ID, decision: 'approved' }),
    ).rejects.toThrow(/do not hold/i);
  });

  it('will not let the same approval be decided twice', async () => {
    state.approval = approval({ decision: 'approved' });

    await expect(
      recordApprovalDecision(USER, { approvalId: ID, decision: 'approved' }),
    ).rejects.toThrow(/already been decided/i);
  });

  // A rejection is usually "not like this", not "never". Cancelling would
  // throw away the entitlement along with the change.
  it('sends a rejected notice back to assessment rather than cancelling it', async () => {
    state.siblings = [
      { id: ID, decision: 'rejected', taskId: 'task-1' },
      { id: 'other', decision: 'pending', taskId: 'task-2' },
    ];

    const result = await recordApprovalDecision(USER, {
      approvalId: ID,
      decision: 'rejected',
      comment: 'The event date is wrong, it was the 14th.',
    });

    expect(result.rejected).toBe(true);
    expect(result.movedTo).toBe('notice_assessment');
    expect(state.pcUpdates[0]).toMatchObject({
      data: { currentStatus: 'notice_assessment' },
    });
  });

  it('sends a rejected final approval back to pricing', async () => {
    state.approval = approval({ gate: 'final_variation' });
    state.siblings = [
      { id: ID, decision: 'rejected', taskId: 'task-1' },
      { id: 'other', decision: 'pending', taskId: 'task-2' },
    ];

    const result = await recordApprovalDecision(USER, {
      approvalId: ID,
      decision: 'rejected',
      comment: 'Preliminaries are double counted.',
    });

    expect(result.movedTo).toBe('qs_pricing');
  });

  // Leaving the other seat's task open would chase somebody daily for a
  // decision that no longer has any effect.
  it('stops chasing the other seat once the gate is rejected', async () => {
    state.siblings = [
      { id: ID, decision: 'rejected', taskId: 'task-1' },
      { id: 'other', decision: 'pending', taskId: 'task-2' },
    ];

    await recordApprovalDecision(USER, {
      approvalId: ID,
      decision: 'rejected',
      comment: 'Needs the client instruction attached.',
    });

    const cancelled = state.taskUpdates.filter(
      (u) => (u.data as Record<string, unknown>)?.status === 'cancelled',
    );
    expect(cancelled).toHaveLength(1);
  });

  it('refuses a rejection with no reason', () => {
    const result = approvalDecisionSchema.safeParse({ approvalId: ID, decision: 'rejected' });
    expect(result.success).toBe(false);
  });

  it('accepts an approval with no comment, because yes needs no explanation', () => {
    const result = approvalDecisionSchema.safeParse({ approvalId: ID, decision: 'approved' });
    expect(result.success).toBe(true);
  });
});
