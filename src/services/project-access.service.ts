import 'server-only';
import type { Prisma, PrismaClient, ProjectRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ForbiddenError } from '@/lib/errors';
import { hasCapability, hasCompanyWideProjectAccess, type Capability } from '@/lib/rbac';
import type { AuthenticatedUser } from '@/lib/auth/provider';

/**
 * THE ACCESS GATE.
 *
 * Prisma connects with a privileged role that bypasses row level security, so
 * RLS cannot be the thing that stops a Site Engineer on Project A from reading
 * Project B. This file is. Every service that touches a project-scoped table
 * calls in here first, and there are tests that prove each one does.
 *
 * The rule the spec is emphatic about:
 *
 *   A user assigned to Project A must not see Project B documents, pricing,
 *   Potential Changes, tasks, contacts, or dashboard data unless assigned.
 *
 * Two shapes are offered, and choosing the wrong one is the classic mistake:
 *
 *   scopeToUser()        for LISTS. Produces a `where` fragment. A person who
 *                        cannot see a project simply gets fewer rows.
 *   assertProjectAccess() for a SPECIFIC record. Throws 403. Never silently
 *                        returns nothing, because "not found" and "not yours"
 *                        are different bugs and must look different.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** Project ids this user may reach, or `null` meaning "all of them". */
export async function getAccessibleProjectIds(
  user: AuthenticatedUser,
  db: Db = prisma,
): Promise<string[] | null> {
  if (hasCompanyWideProjectAccess(user.systemRole)) return null;

  const memberships = await db.projectMember.findMany({
    where: { userId: user.id, active: true },
    select: { projectId: true },
    distinct: ['projectId'],
  });

  return memberships.map((m) => m.projectId);
}

/**
 * A `where` fragment restricting any project-scoped query to what this user may
 * see. Spread it into the query's `where`; never build one by hand at a call
 * site, because that is where the omissions happen.
 */
export async function scopeToUser(
  user: AuthenticatedUser,
  db: Db = prisma,
): Promise<{ projectId?: { in: string[] } }> {
  const ids = await getAccessibleProjectIds(user, db);
  if (ids === null) return {};
  return { projectId: { in: ids } };
}

/** Same, for querying the `projects` table itself, where the column is `id`. */
export async function scopeProjectsToUser(
  user: AuthenticatedUser,
  db: Db = prisma,
): Promise<{ id?: { in: string[] } }> {
  const ids = await getAccessibleProjectIds(user, db);
  if (ids === null) return {};
  return { id: { in: ids } };
}

export async function getProjectRoles(
  user: AuthenticatedUser,
  projectId: string,
  db: Db = prisma,
): Promise<ProjectRole[]> {
  const memberships = await db.projectMember.findMany({
    where: { userId: user.id, projectId, active: true },
    select: { projectRole: true },
  });
  return memberships.map((m) => m.projectRole);
}

export async function canAccessProject(
  user: AuthenticatedUser,
  projectId: string,
  db: Db = prisma,
): Promise<boolean> {
  if (hasCompanyWideProjectAccess(user.systemRole)) return true;

  const membership = await db.projectMember.findFirst({
    where: { userId: user.id, projectId, active: true },
    select: { id: true },
  });

  return membership !== null;
}

/**
 * The check every mutating service runs first.
 *
 * Without `capability`, it asserts reach — "may this person see this project".
 * With one, it also asserts authority — "may they do this here". A PM on the
 * project can reassign a task; a Site Engineer on the same project cannot.
 */
export async function assertProjectAccess(
  user: AuthenticatedUser,
  projectId: string,
  capability?: Capability,
  db: Db = prisma,
): Promise<{ projectRoles: ProjectRole[] }> {
  const companyWide = hasCompanyWideProjectAccess(user.systemRole);
  const projectRoles = await getProjectRoles(user, projectId, db);

  if (!companyWide && projectRoles.length === 0) {
    throw new ForbiddenError();
  }

  if (capability && !hasCapability(user.systemRole, projectRoles, capability)) {
    throw new ForbiddenError(`Your role does not permit this action on this project`);
  }

  return { projectRoles };
}

/** Company-level authority, unrelated to any project. */
export function assertCapability(user: AuthenticatedUser, capability: Capability): void {
  if (!hasCapability(user.systemRole, [], capability)) {
    throw new ForbiddenError('Your role does not permit this action');
  }
}
