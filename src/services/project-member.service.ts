import 'server-only';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { NotFoundError } from '@/lib/errors';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit } from '@/services/audit-log.service';
import { assertProjectAccess } from '@/services/project-access.service';

/**
 * Project membership — where a person's authority on a project comes from.
 *
 * A membership row IS the grant. There is no "deny" record, so there is no deny
 * record to forget to write: absence is denial, which is the safe default.
 * Removal is `active: false` rather than a delete, so the audit trail still
 * explains who could do what at the time something happened.
 */

export const memberAssignSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  projectRole: z.enum([
    'project_manager', 'quantity_surveyor', 'site_engineer', 'foreman',
    'commercial_manager', 'contract_administrator', 'procurement_officer',
    'planning_engineer', 'finance_officer', 'document_controller',
    'project_viewer', 'client_viewer', 'consultant_viewer',
  ]),
});

export async function listMembers(user: AuthenticatedUser, projectId: string) {
  await assertProjectAccess(user, projectId);
  return prisma.projectMember.findMany({
    where: { projectId, active: true },
    orderBy: [{ projectRole: 'asc' }],
    include: { user: { select: { id: true, fullName: true, email: true, systemRole: true } } },
  });
}

export async function assignMember(
  user: AuthenticatedUser,
  input: z.infer<typeof memberAssignSchema>,
) {
  await assertProjectAccess(user, input.projectId, 'project.manageMembers');

  const target = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!target) throw new NotFoundError('User not found');

  return prisma.$transaction(async (tx) => {
    // Re-assigning someone previously removed reactivates the same row, so
    // their history on the project stays one continuous record.
    const member = await tx.projectMember.upsert({
      where: {
        projectId_userId_projectRole: {
          projectId: input.projectId,
          userId: input.userId,
          projectRole: input.projectRole,
        },
      },
      create: { ...input, assignedByUserId: user.id, active: true },
      update: { active: true, assignedByUserId: user.id, assignedAt: new Date() },
    });

    await recordAudit({
      db: tx,
      projectId: input.projectId,
      userId: user.id,
      recordType: 'project_member',
      recordId: member.id,
      actionType: 'assigned',
      newValue: {
        userId: input.userId,
        userName: target.fullName,
        projectRole: input.projectRole,
      },
    });

    return member;
  });
}

export async function removeMember(user: AuthenticatedUser, memberId: string) {
  const existing = await prisma.projectMember.findUnique({
    where: { id: memberId },
    include: { user: { select: { fullName: true } } },
  });
  if (!existing) throw new NotFoundError('Membership not found');
  await assertProjectAccess(user, existing.projectId, 'project.manageMembers');

  return prisma.$transaction(async (tx) => {
    const updated = await tx.projectMember.update({
      where: { id: memberId },
      data: { active: false },
    });
    await recordAudit({
      db: tx,
      projectId: existing.projectId,
      userId: user.id,
      recordType: 'project_member',
      recordId: memberId,
      actionType: 'unassigned',
      oldValue: { userName: existing.user.fullName, projectRole: existing.projectRole },
    });
    return updated;
  });
}
