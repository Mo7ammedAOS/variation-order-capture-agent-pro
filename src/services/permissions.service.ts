import 'server-only';
import { cache } from 'react';
import type { ProjectRole, RoleScope, SystemRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ForbiddenError, ValidationError } from '@/lib/errors';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit } from '@/services/audit-log.service';
import {
  ALL_CAPABILITIES,
  DEFAULT_PROJECT_ROLE_CAPABILITIES,
  DEFAULT_SYSTEM_ROLE_CAPABILITIES,
  type Capability,
} from '@/lib/rbac';

/**
 * Authority, read from the database.
 *
 * The matrix used to be a hardcoded table in src/lib/rbac.ts, so changing who
 * may approve a variation meant a code edit and a redeploy. Every contractor
 * runs differently, so the matrix belongs to the admin, set on the authority of
 * their director. Those constants are now DEFAULTS ONLY, seeded by migration.
 *
 * ── A missing row is a denial ──────────────────────────────────────────────
 * There is no fallback to the code defaults at runtime. A fallback is how a
 * permission an admin deliberately revoked comes back on the next deploy,
 * silently, and nobody finds out until someone approves something they should
 * not have. If the table is empty the answer is "no" to everything — visible,
 * loud, and fixable from the admin screen.
 *
 * ── Caching ────────────────────────────────────────────────────────────────
 * `cache()` dedupes within one request. Beyond that a short process-level TTL
 * keeps a busy page from hammering the table, and every write clears it. The
 * TTL is the ceiling on how long a revoked permission can still be honoured on
 * an already-running container, which is why it is seconds rather than minutes.
 */

const MATRIX_TTL_MS = 15_000;

export type PermissionMatrix = {
  system: Partial<Record<SystemRole, Set<Capability>>>;
  project: Partial<Record<ProjectRole, Set<Capability>>>;
};

let cached: { matrix: PermissionMatrix; expiresAt: number } | null = null;

/** Dropped on every write, so an admin's change takes effect on the next read. */
export function invalidatePermissionCache(): void {
  cached = null;
}

async function loadMatrix(): Promise<PermissionMatrix> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.matrix;

  const rows = await prisma.rolePermission.findMany({
    where: { granted: true },
    select: { scope: true, role: true, capability: true },
  });

  const matrix: PermissionMatrix = { system: {}, project: {} };
  for (const row of rows) {
    const bucket = matrix[row.scope as 'system' | 'project'] as Record<string, Set<Capability>>;
    (bucket[row.role] ??= new Set()).add(row.capability as Capability);
  }

  cached = { matrix, expiresAt: now + MATRIX_TTL_MS };
  return matrix;
}

/** Per-request memoisation on top of the process cache. */
export const getPermissionMatrix = cache(loadMatrix);

export async function systemRoleHasCapability(
  role: SystemRole,
  capability: Capability,
): Promise<boolean> {
  const matrix = await getPermissionMatrix();
  return matrix.system[role]?.has(capability) ?? false;
}

export async function projectRoleHasCapability(
  role: ProjectRole,
  capability: Capability,
): Promise<boolean> {
  const matrix = await getPermissionMatrix();
  return matrix.project[role]?.has(capability) ?? false;
}

/**
 * The combined check. Membership in ANY project role granting the capability is
 * enough — someone who is both QS and Contract Administrator gets the union of
 * the two, not the intersection.
 */
export async function hasCapability(
  systemRole: SystemRole,
  projectRoles: readonly ProjectRole[],
  capability: Capability,
): Promise<boolean> {
  const matrix = await getPermissionMatrix();
  if (matrix.system[systemRole]?.has(capability)) return true;
  return projectRoles.some((role) => matrix.project[role]?.has(capability));
}

/**
 * Company-wide project reach.
 *
 * This used to be a second hardcoded list, COMPANY_WIDE_ROLES, sitting beside
 * the capability matrix and free to disagree with the `project.viewAll`
 * capability that means the same thing. Two sources of truth for one question
 * is a drift waiting to happen, so reach is now that capability and nothing
 * else — which also makes "who can see every project" something the admin can
 * actually change.
 */
/**
 * Everyone on a project who may actually do a given thing.
 *
 * This exists because of a defect that is very easy to write and almost
 * impossible to spot from the code: work was routed by ROLE NAME, while
 * permission is decided by the matrix. `commercial_manager ?? project_manager`
 * looks like a sensible fallback and is not one, because the fallback target
 * may hold no such authority. The result was a notice assessment assigned to a
 * project manager who then saw no button anywhere on the page, and no
 * explanation — the app asking someone for a decision it would refuse to
 * accept from them.
 *
 * Routing therefore asks the same question the button asks. If an admin grants
 * project managers the right to assess a notice, they start receiving the work
 * in the same moment, with no code change.
 *
 * A member's own system role counts too: a Commercial Director sitting on a
 * project as an observer still holds company-wide authority.
 */
export async function listMembersWithCapability(projectId: string, capability: Capability) {
  const [matrix, members] = await Promise.all([
    getPermissionMatrix(),
    prisma.projectMember.findMany({
      // A deactivated person is not a candidate for work. Their membership row
      // survives so history still reads correctly; that is not the same as
      // being available on Monday.
      where: { projectId, active: true, user: { active: true } },
      orderBy: { assignedAt: 'asc' },
      select: { userId: true, projectRole: true, user: { select: { systemRole: true } } },
    }),
  ]);

  return members.filter(
    (member) =>
      matrix.project[member.projectRole]?.has(capability) === true ||
      matrix.system[member.user.systemRole]?.has(capability) === true,
  );
}

/**
 * Who should be given this piece of work, or null when nobody on the project
 * may do it.
 *
 * `preferredRoles` is seniority for this particular decision, not seniority in
 * general — the entitlement question belongs to the Commercial Manager where
 * one exists. Null is a legitimate and important answer: better an unowned
 * task that shows as a bottleneck than one parked on somebody who cannot act,
 * which looks handled and is not.
 */
export async function pickResponsibleMember(
  projectId: string,
  capability: Capability,
  preferredRoles: ProjectRole[] = [],
): Promise<string | null> {
  const holders = await listMembersWithCapability(projectId, capability);

  for (const role of preferredRoles) {
    const match = holders.find((holder) => holder.projectRole === role);
    if (match) return match.userId;
  }

  return holders[0]?.userId ?? null;
}

/**
 * Everybody in the company who holds a capability by SYSTEM role alone.
 *
 * ── The gap this closes ───────────────────────────────────────────────────
 * `listMembersWithCapability` walks the project's MEMBERS. That is right for
 * work belonging to the job — you cannot assess a notice on a project you were
 * never put on. It is wrong for the people whose authority is the company's
 * rather than the project's: a managing director is not a member of anything,
 * because being added to forty projects one at a time is not how a director
 * works.
 *
 * The consequence was silent. On 2026-09-05 the managing director had been
 * told about no capture at all, on any project, since the system went live —
 * the code asked for the directors "on the project", the honest answer was
 * none, and an empty list is not an error.
 *
 * Deactivated people are excluded. Their authority is a fact about the past.
 */
export async function listCompanyWideHolders(capability: Capability): Promise<string[]> {
  const matrix = await getPermissionMatrix();

  const roles = (Object.keys(matrix.system) as SystemRole[]).filter((role) =>
    matrix.system[role]?.has(capability),
  );
  if (roles.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { active: true, systemRole: { in: roles } },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

export async function hasCompanyWideProjectAccess(systemRole: SystemRole): Promise<boolean> {
  return systemRoleHasCapability(systemRole, 'project.viewAll');
}

/* ─────────────────────────── administration ─────────────────────────────── */

/**
 * Roles that can never be granted anything.
 *
 * `client_viewer` and `consultant_viewer` are people OUTSIDE the company —
 * the other side of the table in a variation dispute. Making them writable
 * should not be one mis-click on an admin screen, so the service refuses it
 * whatever the request says.
 */
const LOCKED_PROJECT_ROLES: ReadonlySet<string> = new Set([
  'client_viewer',
  'consultant_viewer',
]);

const permissionUpdateSchema = z.object({
  scope: z.enum(['system', 'project']),
  role: z.string().min(1),
  capability: z.enum(ALL_CAPABILITIES),
  granted: z.boolean(),
});

export type PermissionUpdateInput = z.input<typeof permissionUpdateSchema>;

function assertAdmin(user: AuthenticatedUser): void {
  if (!user.canAdministerCompany) {
    throw new ForbiddenError('Only a company administrator can change permissions');
  }
}

/** The whole matrix, for the admin screen. Grants and denials both. */
export async function listPermissions(user: AuthenticatedUser) {
  assertAdmin(user);
  return prisma.rolePermission.findMany({
    orderBy: [{ scope: 'asc' }, { role: 'asc' }, { capability: 'asc' }],
  });
}

export async function setPermission(user: AuthenticatedUser, input: PermissionUpdateInput) {
  assertAdmin(user);
  const data = permissionUpdateSchema.parse(input);

  if (data.scope === 'project' && LOCKED_PROJECT_ROLES.has(data.role)) {
    throw new ValidationError(
      `${data.role} is a role for people outside the company and cannot be granted authority`,
    );
  }

  // An admin who revokes user.manage from their own system role, and holds the
  // flag through that role alone, locks the company out of its own permissions.
  // The flag is separate precisely so this is recoverable, but refusing is
  // still kinder than the alternative.
  if (
    data.scope === 'system' &&
    data.capability === 'user.manage' &&
    data.granted === false &&
    data.role === user.systemRole
  ) {
    throw new ValidationError('You cannot remove user management from your own role');
  }

  const previous = await prisma.rolePermission.findUnique({
    where: {
      scope_role_capability: {
        scope: data.scope as RoleScope,
        role: data.role,
        capability: data.capability,
      },
    },
  });

  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.rolePermission.upsert({
      where: {
        scope_role_capability: {
          scope: data.scope as RoleScope,
          role: data.role,
          capability: data.capability,
        },
      },
      create: { ...data, scope: data.scope as RoleScope, updatedByUserId: user.id },
      update: { granted: data.granted, updatedByUserId: user.id },
    });

    // Permission changes are exactly what gets disputed later — "who allowed
    // them to approve that" — so the trail records the before and the after.
    await recordAudit({
      db: tx,
      userId: user.id,
      recordType: 'role_permission',
      recordId: row.id,
      actionType: previous ? 'updated' : 'created',
      oldValue: previous ? { granted: previous.granted } : undefined,
      newValue: { scope: data.scope, role: data.role, capability: data.capability, granted: data.granted },
    });

    return row;
  });

  invalidatePermissionCache();
  return result;
}

/** Puts every role back to the shipped baseline. Audited as one event. */
export async function resetPermissionsToDefaults(user: AuthenticatedUser) {
  assertAdmin(user);

  const rows: { scope: RoleScope; role: string; capability: string }[] = [];
  for (const [role, caps] of Object.entries(DEFAULT_SYSTEM_ROLE_CAPABILITIES)) {
    for (const capability of caps) rows.push({ scope: 'system', role, capability });
  }
  for (const [role, caps] of Object.entries(DEFAULT_PROJECT_ROLE_CAPABILITIES)) {
    for (const capability of caps) rows.push({ scope: 'project', role, capability });
  }

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({});
    await tx.rolePermission.createMany({
      data: rows.map((row) => ({ ...row, granted: true, updatedByUserId: user.id })),
    });
    await recordAudit({
      db: tx,
      userId: user.id,
      recordType: 'role_permission',
      recordId: 'all',
      actionType: 'permissions_reset',
      newValue: { restored: rows.length },
    });
  });

  invalidatePermissionCache();
  return { restored: rows.length };
}
