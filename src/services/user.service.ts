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
  assertCapability(user, 'user.manage');
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
  assertCapability(actor, 'user.manage');

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

export async function setUserActive(
  actor: AuthenticatedUser,
  userId: string,
  active: boolean,
) {
  assertCapability(actor, 'user.manage');

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new NotFoundError('User not found');

  // Locking yourself out of the only admin account is a support call, not a
  // feature. The check is cheap.
  if (!active && userId === actor.id) {
    throw new ConflictError('You cannot deactivate your own account');
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

export async function setSystemRole(
  actor: AuthenticatedUser,
  userId: string,
  systemRole: SystemRole,
) {
  assertCapability(actor, 'user.manage');

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
