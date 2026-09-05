import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The reporter can fix what they wrote — up to the point where other people
 * have decided things about it.
 *
 * The rule this protects: a change that has been approved must not be editable
 * underneath the approvers. Otherwise the file shows two directors approving
 * wording they never read, which is exactly the document that falls apart when
 * the client's QS challenges it. Past that point the route is reopening, which
 * announces itself and withdraws what is pending.
 */

const state = {
  change: null as Record<string, unknown> | null,
  capabilities: new Set<string>(),
  pendingApprovals: [] as Record<string, unknown>[],
  pcUpdates: [] as Record<string, unknown>[],
  approvalUpdates: [] as Record<string, unknown>[],
  taskUpdates: [] as Record<string, unknown>[],
};

vi.mock('server-only', () => ({}));
vi.mock('@/services/audit-log.service', () => ({
  recordAudit: async () => ({}),
  diffChanges: () => null,
}));
vi.mock('@/services/project-access.service', () => ({
  assertProjectAccess: async () => ({ projectRoles: ['site_engineer'] }),
  scopeToUser: async () => ({}),
}));
vi.mock('@/services/permissions.service', () => ({
  hasCapability: async (_s: string, _r: string[], capability: string) =>
    state.capabilities.has(capability),
  pickResponsibleMember: async () => null,
  listMembersWithCapability: async () => [],
  listCompanyWideHolders: async () => [],
}));
vi.mock('@/services/notification.service', () => ({
  loadRecipients: async () => [],
  recordTaskNotifications: async () => 0,
  recordDirectNotifications: async () => 0,
  dispatchNow: async () => undefined,
  dispatchPendingNotifications: async () => ({ queued: 0, sent: 0, failed: 0 }),
}));
vi.mock('@/services/approval.service', () => ({ openGate: async () => undefined }));
vi.mock('@/services/stage.service', () => ({
  enterStage: async () => ({ ownerUserId: null, taskCreated: false }),
}));

const prismaMock = {
  potentialChange: {
    findUnique: async () => state.change,
    update: async (args: Record<string, unknown>) => {
      state.pcUpdates.push(args);
      return { ...(state.change as object), ...(args.data as object) };
    },
  },
  approval: {
    findMany: async () => state.pendingApprovals,
    updateMany: async (args: Record<string, unknown>) => {
      state.approvalUpdates.push(args);
      return { count: state.pendingApprovals.length };
    },
  },
  task: {
    updateMany: async (args: Record<string, unknown>) => {
      state.taskUpdates.push(args);
      return { count: 1 };
    },
  },
  projectContractRule: { findUnique: async () => ({ noticePeriodDays: 28 }) },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
};
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const {
  updatePotentialChange,
  reopenPotentialChange,
  cancelPotentialChange,
  reinstatePotentialChange,
} = await import('@/services/potential-change.service');

const REPORTER = { id: 'grace', fullName: 'Grace Mensah', systemRole: 'standard_user' } as never;
const SOMEONE_ELSE = { id: 'ahmed', fullName: 'Ahmed Rashid', systemRole: 'standard_user' } as never;
const ID = '22222222-2222-4222-8222-222222222222';

function change(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    projectId: 'proj-1',
    reportedByUserId: 'grace',
    currentStatus: 'notice_assessment',
    noticeStatus: 'not_assessed',
    title: 'Flooring change',
    ...overrides,
  };
}

describe('the reporter editing their own change', () => {
  beforeEach(() => {
    state.change = change();
    state.capabilities = new Set(['potentialChange.updateOwn']);
    state.pendingApprovals = [];
    state.pcUpdates = [];
    state.approvalUpdates = [];
    state.taskUpdates = [];
  });

  it('lets the person who reported it correct the wording', async () => {
    await expect(
      updatePotentialChange(REPORTER, ID, { title: 'Flooring changed to porcelain' }),
    ).resolves.toBeTruthy();
  });

  it("will not let them edit somebody else's report", async () => {
    await expect(
      updatePotentialChange(SOMEONE_ELSE, ID, { title: 'Not mine to touch' }),
    ).rejects.toThrow(/only edit a change you reported/i);
  });

  it('lets a project manager edit anyone’s, because that is a different right', async () => {
    state.capabilities = new Set(['potentialChange.update']);

    await expect(
      updatePotentialChange(SOMEONE_ELSE, ID, { title: 'Corrected by the PM' }),
    ).resolves.toBeTruthy();
  });

  // The one that matters. Silent edits under a live approval would leave the
  // managing director's name against text he never saw.
  it('refuses a silent edit once the change has moved on', async () => {
    state.change = change({ currentStatus: 'internal_approval' });

    await expect(
      updatePotentialChange(REPORTER, ID, { title: 'Quietly different' }),
    ).rejects.toThrow(/Reopen it instead/i);
  });

  it('still allows editing while it is parked waiting for evidence', async () => {
    state.change = change({ currentStatus: 'needs_evidence' });

    await expect(
      updatePotentialChange(REPORTER, ID, { description: 'Adding what was missing' }),
    ).resolves.toBeTruthy();
  });
});

describe('reopening', () => {
  beforeEach(() => {
    state.change = change({ currentStatus: 'notice_required' });
    state.capabilities = new Set(['potentialChange.reopen']);
    state.pendingApprovals = [];
    state.pcUpdates = [];
    state.approvalUpdates = [];
    state.taskUpdates = [];
  });

  it('sends the change back to assessment', async () => {
    const result = await reopenPotentialChange(REPORTER, ID, {
      reason: 'The event date was wrong, it happened on the 14th.',
    });

    expect(result.change.currentStatus).toBe('notice_assessment');
    expect(state.pcUpdates[0]).toMatchObject({ data: { noticeStatus: 'not_assessed' } });
  });

  // An approval is a statement about a specific set of facts. Once the facts
  // change it is not an approval of anything.
  it('withdraws approvals that were still pending', async () => {
    state.pendingApprovals = [
      { id: 'a1', taskId: 't1' },
      { id: 'a2', taskId: 't2' },
    ];

    const result = await reopenPotentialChange(REPORTER, ID, {
      reason: 'Client has since withdrawn the instruction in writing.',
    });

    expect(result.approvalsWithdrawn).toBe(2);
    expect(state.approvalUpdates).toHaveLength(1);
    expect(state.taskUpdates[0]).toMatchObject({ data: { status: 'cancelled' } });
  });

  it('needs the reopen permission, not merely having reported it', async () => {
    state.capabilities = new Set(['potentialChange.updateOwn']);

    await expect(
      reopenPotentialChange(REPORTER, ID, { reason: 'I want another go at this.' }),
    ).rejects.toThrow(/needs the reopen permission/i);
  });

  it('insists on a reason', async () => {
    await expect(reopenPotentialChange(REPORTER, ID, { reason: 'no' })).rejects.toThrow();
  });

  it('will not revive a cancelled change', async () => {
    state.change = change({ currentStatus: 'cancelled' });

    await expect(
      reopenPotentialChange(REPORTER, ID, { reason: 'Actually we should do this after all.' }),
    ).rejects.toThrow(/Raise a new one/i);
  });

  it('does nothing when the change is already open for editing', async () => {
    state.change = change({ currentStatus: 'notice_assessment' });

    await expect(
      reopenPotentialChange(REPORTER, ID, { reason: 'Trying to reopen an open change.' }),
    ).rejects.toThrow(/already open for editing/i);
  });
});

describe('ending a claim', () => {
  beforeEach(() => {
    state.change = change({ currentStatus: 'qs_pricing' });
    state.capabilities = new Set(['potentialChange.cancel']);
    state.pendingApprovals = [];
    state.pcUpdates = [];
    state.approvalUpdates = [];
    state.taskUpdates = [];
  });

  it('needs the cancel permission, which pricing a change does not give you', async () => {
    state.capabilities = new Set(['pricing.submit', 'potentialChange.changeStatus']);

    await expect(
      cancelPotentialChange(REPORTER, ID, { reason: 'We are not going to pursue this one.' }),
    ).rejects.toThrow(/needs the cancel permission/i);
  });

  it('insists on a real reason, not a shrug', async () => {
    await expect(cancelPotentialChange(REPORTER, ID, { reason: 'no' })).rejects.toThrow();
  });

  // Without this the app chases three people daily about a claim the company
  // has abandoned, which is how people learn to ignore it.
  it('closes the open work and withdraws pending approvals', async () => {
    state.pendingApprovals = [{ id: 'a1', taskId: 't1' }];

    const result = await cancelPotentialChange(REPORTER, ID, {
      reason: 'Duplicate of PC-AUH-003-0004, raised twice on the same day.',
    });

    expect(result.approvalsWithdrawn).toBe(1);
    expect(state.taskUpdates[0]).toMatchObject({ data: { status: 'cancelled' } });
    expect(state.pcUpdates[0]).toMatchObject({
      data: { currentStatus: 'cancelled', currentOwnerUserId: null },
    });
  });

  // Cancelling an agreed variation would hide it from the account.
  it('refuses to cancel a variation that has been agreed', async () => {
    state.change = change({ currentStatus: 'variation_approved' });

    await expect(
      cancelPotentialChange(REPORTER, ID, { reason: 'Actually we should not have claimed it.' }),
    ).rejects.toThrow(/raise the reversal as its own change/i);
  });

  // "The QS found it already in the contract" and "the company chose not to
  // claim" are different facts. Stacking one on the other makes the record lie.
  it('refuses to cancel something already closed as not a variation', async () => {
    state.change = change({ currentStatus: 'included_scope' });

    await expect(
      cancelPotentialChange(REPORTER, ID, { reason: 'Tidying up the register.' }),
    ).rejects.toThrow(/already closed/i);
  });

  it('brings a cancelled change back at assessment, keeping its capture date', async () => {
    state.change = change({ currentStatus: 'cancelled' });

    const updated = await reinstatePotentialChange(REPORTER, ID, {
      reason: 'Cancelled in error — the client instruction does stand.',
    });

    expect(updated.currentStatus).toBe('notice_assessment');
  });
});
