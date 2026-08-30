import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testPrisma } from '../db';
import type { AuthenticatedUser } from '@/lib/auth/provider';

/**
 * THE test. Everything else in this product is a convenience; this is the
 * promise made to a fit-out contractor whose projects belong to competing
 * clients.
 *
 * Skipped automatically without a real DATABASE_URL, and it says so — a
 * silently skipped access-control test is how a leak ships.
 */

const hasDatabase =
  !!process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('placeholder');

const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  console.warn(
    '\n  ⚠ project-access integration tests SKIPPED — no real DATABASE_URL.\n' +
      '    These prove cross-project isolation. Run them before deploying.\n',
  );
}

const prisma = testPrisma();
const suffix = randomUUID().slice(0, 8);

let projectA = '';
let projectB = '';
let engineerA: AuthenticatedUser;
let directorUser: AuthenticatedUser;

describeDb('project access isolation', () => {
  beforeAll(async () => {
    const a = await prisma.project.create({
      data: { projectCode: `TSTA-${suffix}`, projectName: 'Test A', clientName: 'Client A' },
    });
    const b = await prisma.project.create({
      data: { projectCode: `TSTB-${suffix}`, projectName: 'Test B', clientName: 'Client B' },
    });
    projectA = a.id;
    projectB = b.id;

    const engineer = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `engineer-${suffix}@test.local`,
        fullName: 'Test Engineer',
        systemRole: 'standard_user',
      },
    });
    const director = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `director-${suffix}@test.local`,
        fullName: 'Test Director',
        systemRole: 'managing_director',
      },
    });

    await prisma.projectMember.create({
      data: { projectId: projectA, userId: engineer.id, projectRole: 'site_engineer' },
    });

    engineerA = {
      id: engineer.id, email: engineer.email, fullName: engineer.fullName,
      systemRole: 'standard_user', active: true, canAdministerCompany: false, preferredLanguage: 'en',
    };
    directorUser = {
      id: director.id, email: director.email, fullName: director.fullName,
      systemRole: 'managing_director', active: true, canAdministerCompany: false, preferredLanguage: 'en',
    };
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { projectCode: { contains: suffix } } });
    await prisma.user.deleteMany({ where: { email: { contains: suffix } } });
    await prisma.$disconnect();
  });

  it('gives an engineer only the projects they are assigned to', async () => {
    const { getAccessibleProjectIds } = await import('@/services/project-access.service');
    const ids = await getAccessibleProjectIds(engineerA);

    expect(ids).not.toBeNull();
    expect(ids).toContain(projectA);
    expect(ids).not.toContain(projectB);
  });

  it('gives a Managing Director every project without a membership row', async () => {
    const { getAccessibleProjectIds } = await import('@/services/project-access.service');
    // null means "all projects" — the director has no membership rows at all.
    expect(await getAccessibleProjectIds(directorUser)).toBeNull();
  });

  it('THROWS 403 on another project, rather than returning nothing', async () => {
    const { assertProjectAccess } = await import('@/services/project-access.service');
    const { ForbiddenError } = await import('@/lib/errors');

    await expect(assertProjectAccess(engineerA, projectA)).resolves.toBeDefined();
    // A silent empty result would make a denial indistinguishable from a bug.
    await expect(assertProjectAccess(engineerA, projectB)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses an action the project role does not carry', async () => {
    const { assertProjectAccess } = await import('@/services/project-access.service');
    const { ForbiddenError } = await import('@/lib/errors');

    // A site engineer may raise a change...
    await expect(
      assertProjectAccess(engineerA, projectA, 'potentialChange.create'),
    ).resolves.toBeDefined();

    // ...but must never answer the entitlement question themselves.
    await expect(
      assertProjectAccess(engineerA, projectA, 'potentialChange.assessNotice'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('does not leak Project B changes into a list scoped to the engineer', async () => {
    const { listPotentialChanges } = await import('@/services/potential-change.service');

    const changeB = await prisma.potentialChange.create({
      data: {
        projectId: projectB,
        pcNumber: `PC-TSTB-${suffix}-0001`,
        title: 'Confidential change on the other client project',
        description: 'Should never appear in the engineer list',
        eventDate: new Date(),
      },
    });

    const visible = await listPotentialChanges(engineerA);
    expect(visible.map((c) => c.id)).not.toContain(changeB.id);

    const asDirector = await listPotentialChanges(directorUser);
    expect(asDirector.map((c) => c.id)).toContain(changeB.id);
  });

  it('allocates PC numbers without collision under concurrency', async () => {
    const { createPotentialChange } = await import('@/services/potential-change.service');

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        createPotentialChange(engineerA, {
          projectId: projectA,
          title: `Concurrent change ${index}`,
          description: 'Filed at the same moment as seven others',
          eventDate: new Date(),
          workStatus: 'not_started',
          potentialTimeImpact: false,
          sourceType: 'mobile_form',
          urgency: 'normal',
        }),
      ),
    );

    const numbers = results.map((r) => r.pcNumber);
    // MAX(seq)+1 would produce duplicates here. UPDATE ... RETURNING does not.
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
