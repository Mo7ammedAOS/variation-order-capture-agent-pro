import 'server-only';
import { z } from 'zod';
import type { SystemRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ConflictError, IntegrationError, NotFoundError } from '@/lib/errors';
import { getEnv } from '@/lib/env';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit } from '@/services/audit-log.service';
import { assertCapability } from '@/services/project-access.service';
import { createSupabaseAdminClient } from '@/lib/auth/supabase';

/**
 * User administration.
 *
 * There is NO PUBLIC SIGNUP. The app is on the public internet so that site
 * engineers and PMs can reach it from their phones, which means the only thing
 * standing between the internet and the commercial data is that accounts exist
 * solely because an admin created them.
 *
 * Invited people set their own password from a Supabase link — no one, this
 * application included, ever handles it.
 */

export const inviteSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase()),
  fullName: z.string().trim().min(2).max(200),
  phone: z.string().trim().max(50).optional().nullable(),
  systemRole: z.enum([
    'company_owner', 'company_admin', 'managing_director', 'operations_director',
    'commercial_director', 'commercial_manager', 'contract_administrator',
    'finance_manager', 'procurement_manager', 'standard_user', 'viewer',
  ]).default('standard_user'),
  preferredLanguage: z.enum(['en', 'ar']).default('en'),
});

export async function listUsers(user: AuthenticatedUser) {
  await assertCapability(user, 'user.manage');
  return prisma.user.findMany({
    orderBy: [{ active: 'desc' }, { fullName: 'asc' }],
    include: {
      memberships: {
        where: { active: true },
        select: { projectRole: true, project: { select: { id: true, projectCode: true } } },
      },
    },
  });
}

export async function inviteUser(actor: AuthenticatedUser, input: z.infer<typeof inviteSchema>) {
  await assertCapability(actor, 'user.manage');

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ConflictError('A user with that email already exists');

  const supabase = createSupabaseAdminClient();
  const env = getEnv();

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(input.email, {
    redirectTo: `${env.APP_URL}/login`,
    data: { full_name: input.fullName },
  });

  if (error || !data.user) {
    throw new IntegrationError(`Could not create the identity: ${error?.message ?? 'unknown error'}`);
  }

  // The Supabase identity and our profile row share an id. If this insert
  // fails the identity is orphaned, so it is created immediately and the
  // failure surfaces rather than being swallowed.
  return prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        id: data.user!.id,
        email: input.email,
        fullName: input.fullName,
        phone: input.phone ?? null,
        systemRole: input.systemRole,
        preferredLanguage: input.preferredLanguage,
        active: true,
      },
    });

    await recordAudit({
      db: tx,
      userId: actor.id,
      recordType: 'user',
      recordId: created.id,
      actionType: 'invited',
      newValue: { email: created.email, systemRole: created.systemRole },
    });

    return created;
  });
}

/**
 * The shortest password an administrator may set on somebody's behalf.
 *
 * Twelve, not eight. A password set by one person for another gets read aloud
 * across a site office and typed into a phone, so it will be shared whatever
 * the policy says — the only defence is that it is long enough to survive
 * being guessed by somebody who heard half of it.
 */
const MIN_PASSWORD_LENGTH = 12;

export const passwordResetSchema = z.object({
  userId: z.string().uuid(),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(72, 'Too long — 72 characters is the limit'),
});

/**
 * An administrator setting a new password for a member of staff.
 *
 * ── Why "set", and never "show" ────────────────────────────────────────────
 * Osman asked to see existing passwords. There is nothing to see: Supabase
 * stores a one-way hash, so the plaintext does not exist anywhere in this
 * system or in the identity provider, and no permission could reveal it. That
 * is a property worth keeping rather than a gap to close — a system that CAN
 * show a password is a system where one leaked administrator account exposes
 * every account at once. Setting a new one solves the real problem, which is
 * a man locked out on a Friday afternoon, without creating that one.
 *
 * ── What is recorded ───────────────────────────────────────────────────────
 * That it happened, by whom, to whom, and when. Never the password, not in the
 * audit trail, not in a log line, not in the value returned to the caller. The
 * audit row is what makes this safe to hand to an administrator: the authority
 * to reset an account is also the authority to impersonate its owner, so every
 * use of it has to be visible to the person it was used on.
 */
export async function resetUserPassword(
  actor: AuthenticatedUser,
  input: z.infer<typeof passwordResetSchema>,
) {
  await assertCapability(actor, 'user.manage');

  const target = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, fullName: true, active: true },
  });
  if (!target) throw new NotFoundError('User not found');

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.auth.admin.updateUserById(target.id, {
    password: input.password,
  });

  if (error) {
    // The provider's message can quote the password back in a validation
    // error, so only its shape is passed on.
    throw new IntegrationError('Could not set the password. Check it meets the provider policy.');
  }

  await recordAudit({
    db: prisma,
    userId: actor.id,
    recordType: 'user',
    recordId: target.id,
    actionType: 'updated',
    // Deliberately no `oldValue`/`newValue` carrying anything about the
    // secret. The fact and the actor are the record.
    newValue: { passwordReset: true, email: target.email },
  });

  return { email: target.email, fullName: target.fullName };
}

/**
 * Sending somebody the link to set their own password.
 *
 * The better of the two whenever the person is reachable: the administrator
 * never learns the password, so there is nothing to be overheard, written on a
 * whiteboard, or reused on the man's personal email.
 */
export async function sendPasswordResetLink(actor: AuthenticatedUser, userId: string) {
  await assertCapability(actor, 'user.manage');

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true },
  });
  if (!target) throw new NotFoundError('User not found');

  const supabase = createSupabaseAdminClient();
  const env = getEnv();

  const { error } = await supabase.auth.resetPasswordForEmail(target.email, {
    redirectTo: `${env.APP_URL}/login`,
  });
  if (error) throw new IntegrationError(`Could not send the link: ${error.message}`);

  await recordAudit({
    db: prisma,
    userId: actor.id,
    recordType: 'user',
    recordId: target.id,
    actionType: 'updated',
    newValue: { passwordResetLinkSent: true, email: target.email },
  });

  return { email: target.email, fullName: target.fullName };
}

export async function setUserActive(
  actor: AuthenticatedUser,
  userId: string,
  active: boolean,
) {
  await assertCapability(actor, 'user.manage');

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new NotFoundError('User not found');

  // Locking yourself out of the only admin account is a support call, not a
  // feature. The check is cheap.
  if (!active && userId === actor.id) {
    throw new ConflictError('You cannot deactivate your own account');
  }
  if (!active && target.canAdministerCompany) {
    await assertAnotherAdminRemains(userId);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: userId }, data: { active } });
    await recordAudit({
      db: tx,
      userId: actor.id,
      recordType: 'user',
      recordId: userId,
      actionType: active ? 'activated' : 'deactivated',
      oldValue: { active: target.active },
      newValue: { active },
    });
    return updated;
  });
}

/**
 * Moving a WhatsApp number from one person to another.
 *
 * ── Why it has to be doable from the app ──────────────────────────────────
 * A number was only settable at invite. When the handset changed hands — the
 * site phone passed to a new engineer, a demo number moved onto somebody
 * else's account — the only way to follow it was a database query, so in
 * practice nobody did, and every WhatsApp report went on being filed under the
 * name of whoever held the number first. Osman, 2026-09-05.
 *
 * ── Why it is not simply a text field ─────────────────────────────────────
 * The number IS the identity on WhatsApp. Everything that arrives from that
 * handset is filed under whoever holds it, so two people holding the same one
 * is not a duplicate record, it is a wrong name on a claim.
 *
 * The capture path already refuses to guess between them — an ambiguous number
 * parks the message instead of picking a colleague at random — but that is a
 * safety net, and a safety net that catches everything means nothing works. So
 * the number is TAKEN, not copied: moving it onto somebody clears it from the
 * person who had it, in one transaction, and both halves are audited.
 */
export const phoneSchema = z.object({
  // Digits, spaces and the punctuation people actually type. Deliberately not
  // a strict E.164 rule: a number typed as "+971 50 123 4567" is the same
  // number, and rejecting it teaches the administrator that the field is
  // fussy rather than that the number is wrong.
  phone: z
    .string()
    .trim()
    .max(50)
    .regex(/^[+()\d\s.-]*$/, 'Digits, spaces, + ( ) - and . only')
    .transform((value) => value.replace(/[^+\d]/g, ''))
    .refine((value) => value === '' || /^\+?\d{7,15}$/.test(value), 'That is not a phone number'),
});

export async function setUserPhone(
  actor: AuthenticatedUser,
  userId: string,
  rawPhone: string,
) {
  await assertCapability(actor, 'user.manage');

  const { phone } = phoneSchema.parse({ phone: rawPhone });
  const value = phone === '' ? null : phone;

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new NotFoundError('User not found');

  return prisma.$transaction(async (tx) => {
    // Taken from whoever else holds it, in the same transaction as the grant.
    // Two people on one number means every WhatsApp from it is parked as
    // ambiguous, and a number that works for nobody is worse than either
    // person having it.
    const takenFrom = value
      ? await tx.user.findMany({
          where: { phone: value, id: { not: userId } },
          select: { id: true, fullName: true },
        })
      : [];

    if (takenFrom.length > 0) {
      await tx.user.updateMany({
        where: { id: { in: takenFrom.map((user) => user.id) } },
        data: { phone: null },
      });
      for (const previous of takenFrom) {
        await recordAudit({
          db: tx,
          userId: actor.id,
          recordType: 'user',
          recordId: previous.id,
          actionType: 'updated',
          oldValue: { phone: value },
          newValue: { phone: null },
          metadata: { movedTo: userId },
        });
      }
    }

    const updated = await tx.user.update({ where: { id: userId }, data: { phone: value } });

    await recordAudit({
      db: tx,
      userId: actor.id,
      recordType: 'user',
      recordId: userId,
      actionType: 'updated',
      oldValue: { phone: target.phone },
      newValue: { phone: value },
      metadata: takenFrom.length > 0 ? { takenFrom: takenFrom.map((u) => u.fullName) } : undefined,
    });

    return { user: updated, takenFrom: takenFrom.map((user) => user.fullName) };
  });
}

export async function setSystemRole(
  actor: AuthenticatedUser,
  userId: string,
  systemRole: SystemRole,
) {
  await assertCapability(actor, 'user.manage');

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new NotFoundError('User not found');

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: userId }, data: { systemRole } });
    await recordAudit({
      db: tx,
      userId: actor.id,
      recordType: 'user',
      recordId: userId,
      actionType: 'updated',
      oldValue: { systemRole: target.systemRole },
      newValue: { systemRole },
    });
    return updated;
  });
}

/** Company-wide user list for assignment pickers. Not the admin view. */
export async function listAssignableUsers() {
  return prisma.user.findMany({
    where: { active: true },
    orderBy: { fullName: 'asc' },
    select: { id: true, fullName: true, email: true, systemRole: true },
  });
}

/**
 * Company administration, granted and revoked as a flag.
 *
 * Deliberately not a system role. Whoever administers the app is chosen by the
 * company and their job is usually something else — often the Finance Manager.
 * Folding the two together forced a false choice between recording what someone
 * does and recording that they hold the keys.
 */
export async function setCompanyAdmin(
  actor: AuthenticatedUser,
  userId: string,
  canAdministerCompany: boolean,
) {
  await assertCapability(actor, 'user.manage');

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new NotFoundError('User not found');

  if (!canAdministerCompany) await assertAnotherAdminRemains(userId);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { canAdministerCompany },
    });
    await recordAudit({
      db: tx,
      userId: actor.id,
      recordType: 'user',
      recordId: userId,
      actionType: 'updated',
      oldValue: { canAdministerCompany: target.canAdministerCompany },
      newValue: { canAdministerCompany },
    });
    return updated;
  });
}

/**
 * A company with no administrator cannot invite anyone, cannot change a
 * permission, and cannot recover without a database client and someone who
 * knows what a UUID is. There is no undo, so the check is a refusal.
 */
async function assertAnotherAdminRemains(excludingUserId: string): Promise<void> {
  const others = await prisma.user.count({
    where: { canAdministerCompany: true, active: true, id: { not: excludingUserId } },
  });
  if (others === 0) {
    throw new ConflictError(
      'This is the only company administrator. Give someone else administration first.',
    );
  }
}
