import 'server-only';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { NotFoundError } from '@/lib/errors';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit, diffChanges } from '@/services/audit-log.service';
import { assertProjectAccess } from '@/services/project-access.service';

/**
 * The contact authority register.
 *
 * This is what answers "was that person actually allowed to ask for it?" —
 * the question that separates an instruction from a conversation. Every
 * capability flag is set by a human against the contract. AI never sets one,
 * and the default for all of them is false: authority is granted, never assumed.
 */

export const contactSchema = z.object({
  projectId: z.string().uuid(),
  fullName: z.string().trim().min(2).max(200),
  companyName: z.string().trim().max(200).optional().nullable(),
  jobTitle: z.string().trim().max(200).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(50).optional().nullable(),
  contactType: z.enum([
    'client', 'client_representative', 'consultant', 'engineer', 'architect',
    'interior_designer', 'mep_consultant', 'landlord', 'authority',
    'main_contractor', 'subcontractor', 'supplier', 'internal', 'other',
  ]).default('other'),
  authorityVerified: z.boolean().default(false),
  canRequestChange: z.boolean().default(false),
  canIssueTechnicalInstruction: z.boolean().default(false),
  canInstructWork: z.boolean().default(false),
  canApproveCost: z.boolean().default(false),
  canApproveTime: z.boolean().default(false),
  canSignFinalVo: z.boolean().default(false),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function listContacts(user: AuthenticatedUser, projectId: string) {
  await assertProjectAccess(user, projectId);
  return prisma.contact.findMany({
    where: { projectId, active: true },
    orderBy: [{ contactType: 'asc' }, { fullName: 'asc' }],
  });
}

export async function createContact(user: AuthenticatedUser, input: z.infer<typeof contactSchema>) {
  await assertProjectAccess(user, input.projectId, 'contact.manage');

  return prisma.$transaction(async (tx) => {
    const contact = await tx.contact.create({
      data: { ...input, email: input.email || null },
    });
    await recordAudit({
      db: tx,
      projectId: input.projectId,
      userId: user.id,
      recordType: 'contact',
      recordId: contact.id,
      actionType: 'created',
      newValue: {
        fullName: contact.fullName,
        contactType: contact.contactType,
        authorityVerified: contact.authorityVerified,
      },
    });
    return contact;
  });
}

export async function updateContact(
  user: AuthenticatedUser,
  contactId: string,
  input: Partial<z.infer<typeof contactSchema>>,
) {
  const existing = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!existing) throw new NotFoundError('Contact not found');
  await assertProjectAccess(user, existing.projectId, 'contact.manage');

  const { projectId: _ignored, ...data } = input;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.contact.update({ where: { id: contactId }, data });

    // Authority changes are the ones worth being able to reconstruct later,
    // so the diff is recorded rather than a bare "updated".
    const diff = diffChanges(
      existing as unknown as Record<string, unknown>,
      data as Record<string, unknown>,
    );
    if (diff) {
      await recordAudit({
        db: tx,
        projectId: existing.projectId,
        userId: user.id,
        recordType: 'contact',
        recordId: contactId,
        actionType: 'updated',
        oldValue: diff.oldValue,
        newValue: diff.newValue,
      });
    }
    return updated;
  });
}
