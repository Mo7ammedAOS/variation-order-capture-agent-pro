import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The one rule that makes a public signup button acceptable.
 *
 * `/admin-signup` is reachable by anybody who types it — the repository is
 * public, so the address was never a secret and is not treated as one. What
 * stops a stranger from creating an owner account is that on any deployment
 * which has been set up there is nothing there to do.
 *
 * These tests exist because that rule is the ONLY thing standing between a
 * visitor and an account that can read every project, delete variations, and
 * rewrite the permission matrix. A refactor that loosened it would look
 * harmless and would not break any other test in this suite.
 */

const state = {
  userCount: 0,
  rolePermissionCount: 0,
  settings: null as unknown,
  created: [] as Record<string, unknown>[],
  identities: [] as { id: string; email: string }[],
  createdIdentities: [] as string[],
  deletedIdentities: [] as string[],
  // Runs inside the transaction, after the advisory lock is taken and before
  // the count is re-read. Lets a test simulate somebody else committing first.
  onLock: null as null | (() => void),
};

const tx = {
  $executeRaw: vi.fn(async () => {
    state.onLock?.();
    return 1;
  }),
  user: {
    count: vi.fn(async () => state.userCount),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.created.push(data);
      state.userCount += 1;
      return data;
    }),
  },
  rolePermission: {
    count: vi.fn(async () => state.rolePermissionCount),
    createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
      state.rolePermissionCount = data.length;
      return { count: data.length };
    }),
  },
  companySettings: {
    findFirst: vi.fn(async () => state.settings),
    create: vi.fn(async ({ data }: { data: unknown }) => {
      state.settings = data;
      return data;
    }),
  },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { count: vi.fn(async () => state.userCount) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  },
}));

vi.mock('@/lib/auth/supabase', () => ({
  createSupabaseAdminClient: () => ({
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: state.identities } }),
        createUser: async ({ email }: { email: string }) => {
          const id = `auth-${state.identities.length + 1}`;
          state.identities.push({ id, email });
          state.createdIdentities.push(id);
          return { data: { user: { id } }, error: null };
        },
        updateUserById: async () => ({ data: {}, error: null }),
        deleteUser: async (id: string) => {
          state.deletedIdentities.push(id);
          return { error: null };
        },
      },
    },
  }),
}));

const { createFirstAdministrator, isSetupAvailable } = await import('@/app/(auth)/setup');

const input = {
  email: 'Owner@Company.AE',
  fullName: 'Aryia',
  companyName: 'Osman Contracting',
  password: 'a-long-enough-password',
};

describe('first-run set-up', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.userCount = 0;
    state.rolePermissionCount = 0;
    state.settings = null;
    state.created = [];
    state.identities = [];
    state.createdIdentities = [];
    state.deletedIdentities = [];
    state.onLock = null;
  });

  it('is open only while the company has nobody in it', async () => {
    expect(await isSetupAvailable()).toBe(true);

    state.userCount = 1;
    expect(await isSetupAvailable()).toBe(false);
  });

  it('creates the first account as an owner who can administer the company', async () => {
    const outcome = await createFirstAdministrator(input);

    expect(outcome.ok).toBe(true);
    expect(state.created).toHaveLength(1);
    expect(state.created[0]).toMatchObject({
      systemRole: 'company_owner',
      canAdministerCompany: true,
      active: true,
      // Lower-cased, because every lookup in the app matches on a lower-cased
      // address and a capitalised one would sign in nowhere.
      email: 'owner@company.ae',
    });
  });

  it('refuses once an account exists, and creates no identity in the attempt', async () => {
    state.userCount = 1;

    const outcome = await createFirstAdministrator(input);

    expect(outcome).toMatchObject({ ok: false, reason: 'closed' });
    expect(state.createdIdentities).toHaveLength(0);
  });

  /**
   * Two people opening the page on a fresh deployment at the same moment. Both
   * read a count of zero before either writes. The advisory lock serialises
   * them, and the second one has to lose — otherwise a company ends up with
   * two owners, neither aware of the other.
   */
  it('refuses the loser of a race, and deletes the identity it had already made', async () => {
    state.onLock = () => {
      state.userCount = 1;
    };

    const outcome = await createFirstAdministrator(input);

    expect(outcome).toMatchObject({ ok: false, reason: 'closed' });
    expect(state.created).toHaveLength(0);
    expect(state.deletedIdentities).toEqual(state.createdIdentities);
    expect(state.deletedIdentities).toHaveLength(1);
  });

  /**
   * An identity that outlives its profile row — a wipe that missed it, or an
   * attempt that failed halfway — is reused rather than duplicated. Two
   * identities for one address is the state that locked the live app out once:
   * middleware trusted a token the tables knew nothing about.
   */
  it('reuses an orphaned identity rather than making a second one', async () => {
    state.identities = [{ id: 'auth-existing', email: 'owner@company.ae' }];

    const outcome = await createFirstAdministrator(input);

    expect(outcome.ok).toBe(true);
    expect(state.createdIdentities).toHaveLength(0);
    expect(state.created[0]).toMatchObject({ id: 'auth-existing' });
  });

  /**
   * A wiped database has no `role_permissions` rows, and a missing row is a
   * denial. Without this the first owner signs in successfully and then finds
   * they can do nothing at all — including grant themselves the permission
   * that would fix it.
   */
  it('lays down the permission matrix when there is none', async () => {
    await createFirstAdministrator(input);

    expect(state.rolePermissionCount).toBeGreaterThan(100);
    expect(state.settings).toMatchObject({ displayCompanyName: 'Osman Contracting' });
  });

  it('never overwrites a permission matrix that already exists', async () => {
    state.rolePermissionCount = 3;

    await createFirstAdministrator(input);

    expect(tx.rolePermission.createMany).not.toHaveBeenCalled();
    expect(state.rolePermissionCount).toBe(3);
  });
});
