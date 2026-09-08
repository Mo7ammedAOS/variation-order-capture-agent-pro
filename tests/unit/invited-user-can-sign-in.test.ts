import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An invited account must be able to sign in once an administrator sets its
 * password.
 *
 * ── The fault this locks down ─────────────────────────────────────────────
 * `inviteUserByEmail` creates an identity that is NOT confirmed — it becomes
 * confirmed when the person clicks the invitation. Supabase refuses
 * `signInWithPassword` for an unconfirmed address. So an administrator who set
 * a password directly, which is the documented remedy when the invitation is
 * slow, produced an account with a valid password that could not sign in. On
 * 2026-09-08 that was every invited user on the live deployment.
 *
 * The test asserts the flag rather than the outcome because the outcome lives
 * inside Supabase. `email_confirm: true` on this call is the whole fix, and it
 * is one word away from being deleted by someone tidying the call up.
 */

const updateUserById = vi.fn(async () => ({ data: {}, error: null }));
const createUser = vi.fn(async () => ({ data: { user: { id: 'auth-1' } }, error: null }));
const inviteUserByEmail = vi.fn(async () => ({ data: { user: { id: 'auth-1' } }, error: null }));

vi.mock('@/lib/auth/supabase', () => ({
  createSupabaseAdminClient: () => ({
    auth: { admin: { updateUserById, createUser, inviteUserByEmail } },
  }),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: async (args: { where: { email?: string } }) =>
        args.where.email
          ? null // nobody with that address yet, so the invite proceeds
          : { id: 'user-1', email: 'invited@company.ae', fullName: 'Invited Person', active: true },
      create: async ({ data }: { data: Record<string, unknown> }) => data,
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        user: { create: async ({ data }: { data: Record<string, unknown> }) => data },
      }),
  },
}));

vi.mock('@/services/project-access.service', () => ({
  assertCapability: async () => undefined,
}));

vi.mock('@/services/audit-log.service', () => ({ recordAudit: async () => undefined }));

const { resetUserPassword, inviteUser } = await import('@/services/user.service');

const actor = { id: 'admin-1', systemRole: 'company_owner' } as never;

describe('an administrator setting a password', () => {
  beforeEach(() => vi.clearAllMocks());

  it('confirms the address, or the account it just fixed still cannot sign in', async () => {
    await resetUserPassword(actor, {
      userId: 'user-1',
      password: 'a-long-enough-password',
    } as never);

    expect(updateUserById).toHaveBeenCalledTimes(1);
    const [, payload] = updateUserById.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(payload.email_confirm).toBe(true);
    expect(payload.password).toBe('a-long-enough-password');
  });

  it('never returns or echoes the password', async () => {
    const result = await resetUserPassword(actor, {
      userId: 'user-1',
      password: 'a-long-enough-password',
    } as never);

    expect(JSON.stringify(result)).not.toContain('a-long-enough-password');
  });
});

/**
 * Creating an account must not depend on an email being sent.
 *
 * `inviteUserByEmail` sends an invitation, and Supabase's built-in mailer is
 * rate limited to a handful an hour on any project without its own SMTP. Adding
 * a team of seven in one sitting failed partway through with "email rate limit
 * exceeded" — and failed completely, because the limit is enforced before the
 * identity is written. An administrator sitting at the screen adding people
 * should not be blocked by a message they did not ask to send.
 */
describe('adding a user', () => {
  beforeEach(() => vi.clearAllMocks());

  const input = {
    email: 'new@company.ae',
    fullName: 'New Person',
    systemRole: 'standard_user',
    preferredLanguage: 'en',
  };

  it('sends no email at all', async () => {
    await inviteUser(actor, input as never);

    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(createUser).toHaveBeenCalledTimes(1);
  });

  it('confirms the address, because there is no invitation to click', async () => {
    await inviteUser(actor, input as never);

    const [payload] = createUser.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(payload.email_confirm).toBe(true);
    expect(payload.email).toBe('new@company.ae');
  });
});
