import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { AuthenticatedUser } from '@/lib/auth/provider';

/**
 * The lifecycle guard against a real database.
 *
 * The unit test proves the map; this proves the service actually consults it
 * before writing, and that a refusal is a refusal rather than a silent no-op.
 */

const hasDatabase =
  !!process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('placeholder');

const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  console.warn('\n  ⚠ status-change integration tests SKIPPED — no real DATABASE_URL.\n');
}

const prisma = new PrismaClient();
const suffix = randomUUID().slice(0, 8);

let projectId = '';
let director: AuthenticatedUser;
let engineer: AuthenticatedUser;

async function newChange(status: 'notice_assessment' | 'qs_pricing' | 'included_scope') {
  const change = await prisma.potentialChange.create({
    data: {
      projectId,
      pcNumber: `PC-TSTS-${suffix}-${randomUUID().slice(0, 4)}`,
      title: 'Lifecycle test change',
      description: 'Exists to be moved, or refused',
      eventDate: new Date(Date.UTC(2026, 7, 1)),
      currentStatus: status,
    },
  });
  return change.id;
}

describeDb('potential change status transitions', () => {
  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        projectCode: `TSTS-${suffix}`,
        projectName: 'Status Test',
        clientName: 'Client S',
        contractRules: { create: {} },
      },
    });
    projectId = project.id;

    const directorRecord = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `st-director-${suffix}@test.local`,
        fullName: 'Status Director',
        systemRole: 'commercial_director',
      },
    });
    const engineerRecord = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `st-engineer-${suffix}@test.local`,
        fullName: 'Status Engineer',
        systemRole: 'standard_user',
      },
    });
    await prisma.projectMember.create({
      data: { projectId, userId: engineerRecord.id, projectRole: 'site_engineer' },
    });

    director = {
      id: directorRecord.id, email: directorRecord.email, fullName: directorRecord.fullName,
      systemRole: 'commercial_director', active: true, preferredLanguage: 'en',
    };
    engineer = {
      id: engineerRecord.id, email: engineerRecord.email, fullName: engineerRecord.fullName,
      systemRole: 'standard_user', active: true, preferredLanguage: 'en',
    };
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { projectCode: { contains: suffix } } });
    await prisma.user.deleteMany({ where: { email: { contains: suffix } } });
    await prisma.$disconnect();
  });

  it('REFUSES to walk a change past the notice assessment', async () => {
    const { changeStatus } = await import('@/services/potential-change.service');
    const { ValidationError } = await import('@/lib/errors');
    const id = await newChange('notice_assessment');

    await expect(changeStatus(director, id, 'included_scope')).rejects.toBeInstanceOf(
      ValidationError,
    );

    // A refusal that left the row changed anyway would be worse than no check.
    const after = await prisma.potentialChange.findUniqueOrThrow({ where: { id } });
    expect(after.currentStatus).toBe('notice_assessment');
  });

  it('refuses to move a change that has already ended', async () => {
    const { changeStatus } = await import('@/services/potential-change.service');
    const { ValidationError } = await import('@/lib/errors');
    const id = await newChange('included_scope');

    await expect(changeStatus(director, id, 'qs_pricing')).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a site engineer, who may raise a change but not move it on', async () => {
    const { changeStatus } = await import('@/services/potential-change.service');
    const { ForbiddenError } = await import('@/lib/errors');
    const id = await newChange('qs_pricing');

    await expect(changeStatus(engineer, id, 'cm_review')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('moves a change through a permitted transition and audits who did it', async () => {
    const { changeStatus } = await import('@/services/potential-change.service');
    const id = await newChange('qs_pricing');

    const updated = await changeStatus(director, id, 'cm_review', 'Pricing complete');
    expect(updated.currentStatus).toBe('cm_review');

    const entry = await prisma.activityLog.findFirst({
      where: { recordType: 'potential_change', recordId: id, actionType: 'status_changed' },
      orderBy: { createdAt: 'desc' },
    });

    expect(entry?.userId).toBe(director.id);
    expect(entry?.oldValueJson).toMatchObject({ currentStatus: 'qs_pricing' });
    expect(entry?.newValueJson).toMatchObject({ currentStatus: 'cm_review' });
    expect(entry?.metadataJson).toMatchObject({ note: 'Pricing complete' });
  });

  it('refuses a move to the status it is already in', async () => {
    const { changeStatus } = await import('@/services/potential-change.service');
    const { ValidationError } = await import('@/lib/errors');
    const id = await newChange('qs_pricing');

    await expect(changeStatus(director, id, 'qs_pricing')).rejects.toBeInstanceOf(ValidationError);
  });
});
