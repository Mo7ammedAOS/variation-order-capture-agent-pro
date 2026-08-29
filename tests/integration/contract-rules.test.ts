import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { AuthenticatedUser } from '@/lib/auth/provider';

/**
 * The contract rules are the most consequential settings in the product:
 * `noticePeriodDays` is what turns an event date into a contractual deadline.
 * Three things have to be true about editing them, and only one is obvious.
 *
 *   1. Not everyone may. A site engineer raising changes on the project must
 *      not be able to lengthen the notice period.
 *   2. Every edit is in the audit trail, with the before and after value. When
 *      a deadline is later disputed, "who changed 28 to 42, and when" is the
 *      question, and an answer of "we cannot tell" is worthless.
 *   3. An edit is NOT retroactive. Deadlines already derived on existing
 *      changes must not move. Rewriting them would rewrite what the company
 *      believed its obligations were, and that record is the whole point.
 *
 * The third is the one a refactor breaks silently, because nothing visible
 * fails — the dates just quietly become wrong.
 */

const hasDatabase =
  !!process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('placeholder');

const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  console.warn('\n  ⚠ contract-rules integration tests SKIPPED — no real DATABASE_URL.\n');
}

const prisma = new PrismaClient();
const suffix = randomUUID().slice(0, 8);

let projectId = '';
let engineer: AuthenticatedUser;
let director: AuthenticatedUser;
let existingChangeId = '';
const originalDueDate = new Date(Date.UTC(2026, 7, 29));

describeDb('contract rules', () => {
  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        projectCode: `TSTC-${suffix}`,
        projectName: 'Contract Rules Test',
        clientName: 'Client C',
        contractRules: { create: { noticePeriodDays: 28 } },
      },
    });
    projectId = project.id;

    const engineerRecord = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `cr-engineer-${suffix}@test.local`,
        fullName: 'Rules Engineer',
        systemRole: 'standard_user',
      },
    });
    const directorRecord = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `cr-director-${suffix}@test.local`,
        fullName: 'Rules Director',
        systemRole: 'commercial_director',
      },
    });

    await prisma.projectMember.create({
      data: { projectId, userId: engineerRecord.id, projectRole: 'site_engineer' },
    });

    engineer = {
      id: engineerRecord.id, email: engineerRecord.email, fullName: engineerRecord.fullName,
      systemRole: 'standard_user', active: true, preferredLanguage: 'en',
    };
    director = {
      id: directorRecord.id, email: directorRecord.email, fullName: directorRecord.fullName,
      systemRole: 'commercial_director', active: true, preferredLanguage: 'en',
    };

    // A change captured under the 28-day rule, with its deadline already set.
    const change = await prisma.potentialChange.create({
      data: {
        projectId,
        pcNumber: `PC-TSTC-${suffix}-0001`,
        title: 'Captured before the rules changed',
        description: 'Its deadline must survive an edit to the contract rules',
        eventDate: new Date(Date.UTC(2026, 7, 1)),
        noticeDueDate: originalDueDate,
      },
    });
    existingChangeId = change.id;
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { projectCode: { contains: suffix } } });
    await prisma.user.deleteMany({ where: { email: { contains: suffix } } });
    await prisma.$disconnect();
  });

  it('refuses a site engineer, who has project access but not the capability', async () => {
    const { updateContractRules } = await import('@/services/project.service');
    const { ForbiddenError } = await import('@/lib/errors');

    await expect(
      updateContractRules(engineer, projectId, { noticePeriodDays: 90 }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const unchanged = await prisma.projectContractRule.findUnique({ where: { projectId } });
    expect(unchanged?.noticePeriodDays).toBe(28);
  });

  it('lets a commercial director change the notice period', async () => {
    const { updateContractRules } = await import('@/services/project.service');

    const updated = await updateContractRules(director, projectId, {
      noticePeriodDays: 42,
      contractClauseReference: '20.1',
    });

    expect(updated.noticePeriodDays).toBe(42);
    expect(updated.contractClauseReference).toBe('20.1');
  });

  it('records the before and after value in the audit trail', async () => {
    const entry = await prisma.activityLog.findFirst({
      where: { projectId, recordType: 'project_contract_rule', actionType: 'updated' },
      orderBy: { createdAt: 'desc' },
    });

    expect(entry).not.toBeNull();
    expect(entry?.userId).toBe(director.id);
    expect(entry?.oldValueJson).toMatchObject({ noticePeriodDays: 28 });
    expect(entry?.newValueJson).toMatchObject({ noticePeriodDays: 42 });
  });

  it('does NOT move a deadline already calculated on an existing change', async () => {
    const change = await prisma.potentialChange.findUniqueOrThrow({
      where: { id: existingChangeId },
    });

    expect(change.noticeDueDate?.toISOString()).toBe(originalDueDate.toISOString());
  });

  it('applies the new period to the next change captured', async () => {
    const { calculateNoticeDueDate } = await import('@/lib/dates');
    const rules = await prisma.projectContractRule.findUniqueOrThrow({ where: { projectId } });

    const eventDate = new Date(Date.UTC(2026, 8, 1));
    const due = calculateNoticeDueDate(eventDate, rules.noticePeriodDays);

    // 1 Sep + 42 days = 13 Oct. The old 28-day rule would have given 29 Sep.
    expect(due.toISOString().slice(0, 10)).toBe('2026-10-13');
  });

  it('clears a threshold when the field is blank, rather than setting it to zero', async () => {
    const { updateContractRules } = await import('@/services/project.service');

    await updateContractRules(director, projectId, { approvalThresholdPm: 50_000 });
    const set = await prisma.projectContractRule.findUniqueOrThrow({ where: { projectId } });
    expect(Number(set.approvalThresholdPm)).toBe(50_000);

    // Blank must mean "no threshold". Zero would mean every change needs a PM.
    await updateContractRules(director, projectId, { approvalThresholdPm: '' });
    const cleared = await prisma.projectContractRule.findUniqueOrThrow({ where: { projectId } });
    expect(cleared.approvalThresholdPm).toBeNull();
  });

  it('rejects a notice period outside a sane range instead of storing it', async () => {
    const { contractRuleUpdateSchema } = await import('@/services/project.service');

    expect(contractRuleUpdateSchema.safeParse({ noticePeriodDays: 0 }).success).toBe(false);
    expect(contractRuleUpdateSchema.safeParse({ noticePeriodDays: 400 }).success).toBe(false);
    expect(contractRuleUpdateSchema.safeParse({ noticePeriodDays: 42 }).success).toBe(true);
  });
});
