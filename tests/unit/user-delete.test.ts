import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Deleting a company member.
 *
 * Three things have to hold, and each of them has already gone wrong on a real
 * system at least once:
 *
 *  1. The sign-in is removed BEFORE the profile row. The other order leaves an
 *     identity that can authenticate with no profile behind it, which bricked
 *     this deployment once — every page died on the missing record, including
 *     the ones needed to undo it.
 *  2. Anybody the commercial record names is refused, not deleted. Their name
 *     is on changes, notices and approvals; removing the row empties all of
 *     those columns and the work ends up attributed to nobody.
 *  3. Nothing at all happens to the identity when the answer is a refusal. A
 *     half-done delete is the worst outcome of the three.
 */

const order: string[] = [];

const deleteUserIdentity = vi.fn(async () => {
  order.push('supabase.deleteUser');
  return { data: {}, error: null as { message: string } | null };
});

vi.mock('@/lib/auth/supabase', () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { deleteUser: deleteUserIdentity } } }),
}));

/** Nothing points at this person. The default for these tests. */
const NO_HISTORY = {
  reportedChanges: 0, ownedChanges: 0, pricingSubmitted: 0, noticesDrafted: 0,
  noticesIssued: 0, noticesAcknowledged: 0, vosSubmitted: 0, vosResponseRecorded: 0,
  invoicesIssued: 0, creditNotesIssued: 0, paymentsRecorded: 0, approvalsDecided: 0,
  approvalsAssigned: 0, assignedTasks: 0, delegatedTasks: 0, uploadedDocuments: 0,
  createdProjects: 0, blockingBottlenecks: 0, activityLogs: 0,
};

let target: Record<string, unknown> | null = null;

const rowDelete = vi.fn(async () => {
  order.push('prisma.user.delete');
  return {};
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: async () => target,
      count: async () => 1, // somebody else administers the company
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ user: { delete: rowDelete }, activityLog: { create: async () => ({}) } }),
  },
}));

vi.mock('@/services/project-access.service', () => ({ assertCapability: async () => undefined }));
vi.mock('@/services/audit-log.service', () => ({ recordAudit: async () => undefined }));

const { deleteUser, describeUserHistory } = await import('@/services/user.service');

const actor = { id: 'admin-1', systemRole: 'company_owner' } as never;

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  deleteUserIdentity.mockImplementation(async () => {
    order.push('supabase.deleteUser');
    return { data: {}, error: null };
  });
  target = {
    id: 'user-9',
    email: 'mistake@company.ae',
    fullName: 'Typed Twice',
    systemRole: 'standard_user',
    canAdministerCompany: false,
    _count: { ...NO_HISTORY },
  };
});

describe('deleting an account with no history', () => {
  it('removes the sign-in before the row, never the other way round', async () => {
    await deleteUser(actor, 'user-9');

    expect(order).toEqual(['supabase.deleteUser', 'prisma.user.delete']);
  });

  it('finishes the job when the sign-in is already gone', async () => {
    deleteUserIdentity.mockImplementation(async () => {
      order.push('supabase.deleteUser');
      return { data: {}, error: { message: 'User not found' } };
    });

    await expect(deleteUser(actor, 'user-9')).resolves.toMatchObject({
      fullName: 'Typed Twice',
    });
    expect(rowDelete).toHaveBeenCalledTimes(1);
  });

  it('stops on any other provider failure, leaving the row intact', async () => {
    deleteUserIdentity.mockImplementation(async () => {
      order.push('supabase.deleteUser');
      return { data: {}, error: { message: 'service unavailable' } };
    });

    await expect(deleteUser(actor, 'user-9')).rejects.toThrow(/Could not remove the sign-in/);
    expect(rowDelete).not.toHaveBeenCalled();
  });
});

describe('deleting somebody the record points at', () => {
  it('refuses, and touches nothing', async () => {
    target = {
      ...(target as Record<string, unknown>),
      fullName: 'Ahmed',
      _count: { ...NO_HISTORY, reportedChanges: 3, noticesIssued: 1 },
    };

    await expect(deleteUser(actor, 'user-9')).rejects.toThrow(/Deactivate them instead/);
    expect(deleteUserIdentity).not.toHaveBeenCalled();
    expect(rowDelete).not.toHaveBeenCalled();
  });

  it('says what still names them, so the refusal is actionable', async () => {
    expect(describeUserHistory({ reportedChanges: 3, noticesIssued: 1 })).toEqual([
      '3 changes they reported',
      '1 notices they issued',
    ]);
  });

  it('counts a single activity entry as history', async () => {
    target = {
      ...(target as Record<string, unknown>),
      _count: { ...NO_HISTORY, activityLogs: 1 },
    };

    await expect(deleteUser(actor, 'user-9')).rejects.toThrow(/activity trail/);
    expect(deleteUserIdentity).not.toHaveBeenCalled();
  });
});

describe('the accounts that can never be deleted', () => {
  it('refuses your own, before it reads anything', async () => {
    await expect(deleteUser(actor, 'admin-1')).rejects.toThrow(/your own account/);
    expect(deleteUserIdentity).not.toHaveBeenCalled();
  });

  it('refuses the last administrator', async () => {
    const prisma = (await import('@/lib/prisma')).prisma as unknown as {
      user: { count: () => Promise<number> };
    };
    prisma.user.count = async () => 0; // nobody else administers the company
    target = { ...(target as Record<string, unknown>), canAdministerCompany: true };

    await expect(deleteUser(actor, 'user-9')).rejects.toThrow(/only company administrator/);
    expect(deleteUserIdentity).not.toHaveBeenCalled();

    prisma.user.count = async () => 1;
  });
});
