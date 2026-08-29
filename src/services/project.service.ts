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

/** Blank means "not set", not zero. An empty form field must not become 0 days. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const days = (min: number, max: number) =>
  z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.coerce.number().int().min(min).max(max),
  );

/**
 * Thresholds are money, so they are Decimal in the database and must not round
 * trip through anything lossy. Blank clears the threshold rather than setting
 * it to zero — a threshold of zero would mean "everything needs this approval",
 * which is the opposite of "no threshold configured".
 */
const optionalMoney = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) => (value === '' || value === null || value === undefined ? null : Number(value)))
  .refine(
    (value) => value === null || (Number.isFinite(value) && value >= 0),
    'Enter a positive amount, or leave it blank for no threshold',
  );

export const contractRuleUpdateSchema = z
  .object({
    contractType: optionalText(120),
    contractClauseReference: optionalText(120),

    noticePeriodDays: days(1, 365),
    detailedClaimPeriodDays: days(1, 365),
    noticeDeliveryMethod: optionalText(120),
    noticeRecipientName: optionalText(200),
    noticeRecipientEmail: z
      .union([z.literal(''), z.string().trim().email('Enter a valid email address')])
      .nullish()
      .transform((value) => (value ? value : null)),
    noticeRecipientCompany: optionalText(200),

    noticeTemplateName: optionalText(200),
    variationProposalTemplateName: optionalText(200),
    eotAssessmentRequired: z.coerce.boolean(),

    approvalThresholdPm: optionalMoney,
    approvalThresholdCm: optionalMoney,
    approvalThresholdCommercialDirector: optionalMoney,
    approvalThresholdManagingDirector: optionalMoney,
    highRiskVoValue: optionalMoney,

    clientFollowUpDays: days(1, 90),
    qsPricingDueDays: days(1, 90),
    pmScopeReviewDueDays: days(1, 90),
    internalApprovalDueDays: days(1, 90),
  })
  .partial();

/**
 * The INPUT type, deliberately. The service parses what it is handed rather
 * than trusting a caller to have done it — a server action, a route handler
 * and a test are three different doors, and only two of them were parsing.
 */
export type ContractRuleUpdateInput = z.input<typeof contractRuleUpdateSchema>;

/**
 * Editing the contract rules.
 *
 * These are the most consequential settings in the product: `noticePeriodDays`
 * is what turns an event date into a contractual deadline, and getting it wrong
 * loses entitlement rather than merely displaying something odd. So the write is
 * gated on `project.manageContractRules` — not merely on project access — and
 * every field change is written to the audit trail inside the same transaction,
 * with its before and after value.
 *
 * A change here is NOT retroactive, and that is deliberate. Deadlines are
 * computed at capture and stored on the potential change, so existing changes
 * keep the deadline that was derived under the rules in force at the time.
 * Silently rewriting historical deadlines because someone corrected a typo
 * would rewrite what the company believed its obligations were, which is
 * exactly the record a dispute turns on. New changes pick up the new rules.
 */
export async function updateContractRules(
  user: AuthenticatedUser,
  projectId: string,
  input: ContractRuleUpdateInput,
) {
  await assertProjectAccess(user, projectId, 'project.manageContractRules');

  // Parsed here, not only at the edge. Blank means "clear it", which the schema
  // turns into null; an unparsed empty string reaches Postgres as a malformed
  // decimal and fails the whole transaction.
  const data = contractRuleUpdateSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const before = await tx.projectContractRule.findUnique({ where: { projectId } });
    if (!before) throw new NotFoundError('Contract rules not configured for this project');

    const updated = await tx.projectContractRule.update({
      where: { projectId },
      data,
    });

    const diff = diffChanges(
      before as unknown as Record<string, unknown>,
      data as Record<string, unknown>,
    );

    if (diff) {
      await recordAudit({
        db: tx,
        projectId,
        userId: user.id,
        recordType: 'project_contract_rule',
        recordId: updated.id,
        actionType: 'updated',
        oldValue: diff.oldValue,
        newValue: diff.newValue,
      });
    }

    return updated;
  });
}
