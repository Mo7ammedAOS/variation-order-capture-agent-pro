import 'server-only';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { NotFoundError } from '@/lib/errors';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit, diffChanges } from '@/services/audit-log.service';
import {
  assertCapability,
  assertProjectAccess,
  scopeProjectsToUser,
} from '@/services/project-access.service';

export const projectCreateSchema = z.object({
  projectCode: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/, 'Use letters, numbers and hyphens, e.g. DXB-001')
    .transform((v) => v.toUpperCase()),
  projectName: z.string().trim().min(2).max(200),
  clientName: z.string().trim().min(2).max(200),
  consultantName: z.string().trim().max(200).optional().nullable(),
  projectLocation: z.string().trim().max(200).optional().nullable(),
  contractNumber: z.string().trim().max(100).optional().nullable(),
  contractStartDate: z.coerce.date().optional().nullable(),
  contractCompletionDate: z.coerce.date().optional().nullable(),
  originalContractValue: z.coerce.number().nonnegative().optional().nullable(),
  currency: z.string().trim().length(3).default('AED'),
  projectStatus: z
    .enum(['tender', 'awarded', 'active', 'on_hold', 'completed', 'closed'])
    .default('active'),
});

export const projectUpdateSchema = projectCreateSchema.partial().omit({ projectCode: true });

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;

export async function listProjects(user: AuthenticatedUser, filters: { search?: string } = {}) {
  const scope = await scopeProjectsToUser(user);

  const where: Prisma.ProjectWhereInput = { ...scope };
  if (filters.search) {
    where.OR = [
      { projectCode: { contains: filters.search, mode: 'insensitive' } },
      { projectName: { contains: filters.search, mode: 'insensitive' } },
      { clientName: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  return prisma.project.findMany({
    where,
    orderBy: { projectCode: 'asc' },
    include: {
      members: {
        where: { active: true },
        include: { user: { select: { id: true, fullName: true } } },
      },
      _count: { select: { potentialChanges: true } },
    },
  });
}

export async function getProject(user: AuthenticatedUser, projectId: string) {
  await assertProjectAccess(user, projectId);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      contractRules: true,
      members: { where: { active: true }, include: { user: true } },
      _count: { select: { potentialChanges: true, tasks: true, documents: true, contacts: true } },
    },
  });

  if (!project) throw new NotFoundError('Project not found');
  return project;
}

export async function createProject(user: AuthenticatedUser, input: ProjectCreateInput) {
  assertCapability(user, 'project.create');

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        ...input,
        originalContractValue: input.originalContractValue ?? null,
        createdByUserId: user.id,
        // Sensible contractual defaults so a new project is never missing the
        // notice period that every deadline is derived from.
        contractRules: { create: {} },
      },
    });

    await recordAudit({
      db: tx,
      projectId: project.id,
      userId: user.id,
      recordType: 'project',
      recordId: project.id,
      actionType: 'created',
      newValue: { projectCode: project.projectCode, projectName: project.projectName },
    });

    return project;
  });
}

export async function updateProject(
  user: AuthenticatedUser,
  projectId: string,
  input: ProjectUpdateInput,
) {
  await assertProjectAccess(user, projectId, 'project.update');

  return prisma.$transaction(async (tx) => {
    const before = await tx.project.findUnique({ where: { id: projectId } });
    if (!before) throw new NotFoundError('Project not found');

    const updated = await tx.project.update({ where: { id: projectId }, data: input });

    const diff = diffChanges(
      before as unknown as Record<string, unknown>,
      input as Record<string, unknown>,
    );
    if (diff) {
      await recordAudit({
        db: tx,
        projectId,
        userId: user.id,
        recordType: 'project',
        recordId: projectId,
        actionType: 'updated',
        oldValue: diff.oldValue,
        newValue: diff.newValue,
      });
    }

    return updated;
  });
}

/** The contract rules drive every deadline on the project. */
export async function getContractRules(user: AuthenticatedUser, projectId: string) {
  await assertProjectAccess(user, projectId);
  const rules = await prisma.projectContractRule.findUnique({ where: { projectId } });
  if (!rules) throw new NotFoundError('Contract rules not configured for this project');
  return rules;
}
