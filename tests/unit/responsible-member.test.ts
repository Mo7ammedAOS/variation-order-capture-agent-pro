import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The defect this guards against shipped, reached production, and was found by
 * a person rather than a test.
 *
 * Work was routed by ROLE NAME — "the commercial manager, or failing that the
 * project manager" — while permission to do that work was decided by the
 * permissions matrix. On a project with no commercial manager the notice
 * assessment landed on the project manager, who is not granted
 * `potentialChange.assessNotice` by default. He held a task he could not
 * complete, and the change page showed him no control and no explanation.
 *
 * The rule these tests exist to hold: NEVER assign work to somebody who is not
 * permitted to do it. An unowned task is the correct answer when nobody can.
 */

let permissionRows: { scope: string; role: string; capability: string }[] = [];
let members: { userId: string; projectRole: string; user: { systemRole: string } }[] = [];
let users: { id: string; systemRole: string; active: boolean }[] = [];

vi.mock('@/lib/prisma', () => ({
  prisma: {
    rolePermission: { findMany: async () => permissionRows },
    projectMember: { findMany: async () => members },
    user: {
      findMany: async ({ where }: { where: { systemRole: { in: string[] }; active: boolean } }) =>
        users.filter(
          (user) => user.active === where.active && where.systemRole.in.includes(user.systemRole),
        ),
    },
  },
}));

vi.mock('server-only', () => ({}));

const {
  pickResponsibleMember,
  listMembersWithCapability,
  listCompanyWideHolders,
  invalidatePermissionCache,
} = await import('@/services/permissions.service');

const CAP = 'potentialChange.assessNotice';

function grant(scope: 'system' | 'project', role: string) {
  permissionRows.push({ scope, role, capability: CAP });
}

describe('routing work to someone who may actually do it', () => {
  beforeEach(() => {
    permissionRows = [];
    members = [];
    users = [];
    invalidatePermissionCache();
  });

  it('prefers the commercial manager when the project has one', async () => {
    grant('project', 'commercial_manager');
    grant('project', 'project_manager');
    members = [
      { userId: 'pm', projectRole: 'project_manager', user: { systemRole: 'standard_user' } },
      { userId: 'cm', projectRole: 'commercial_manager', user: { systemRole: 'standard_user' } },
    ];

    await expect(
      pickResponsibleMember('p1', CAP, ['commercial_manager', 'project_manager']),
    ).resolves.toBe('cm');
  });

  // The exact production case: no commercial manager, and the project manager
  // is not granted the capability.
  it('returns nobody rather than the project manager who cannot assess', async () => {
    grant('project', 'commercial_manager');
    members = [
      { userId: 'pm', projectRole: 'project_manager', user: { systemRole: 'standard_user' } },
      { userId: 'se', projectRole: 'site_engineer', user: { systemRole: 'standard_user' } },
    ];

    await expect(
      pickResponsibleMember('p1', CAP, ['commercial_manager', 'project_manager']),
    ).resolves.toBeNull();
  });

  it('routes to the project manager the moment an admin grants it', async () => {
    grant('project', 'commercial_manager');
    grant('project', 'project_manager');
    members = [
      { userId: 'pm', projectRole: 'project_manager', user: { systemRole: 'standard_user' } },
    ];

    await expect(
      pickResponsibleMember('p1', CAP, ['commercial_manager', 'project_manager']),
    ).resolves.toBe('pm');
  });

  it("counts a member's company-wide system role, not only their project role", async () => {
    grant('system', 'commercial_director');
    members = [
      { userId: 'dir', projectRole: 'site_engineer', user: { systemRole: 'commercial_director' } },
    ];

    await expect(pickResponsibleMember('p1', CAP)).resolves.toBe('dir');
  });

  it('falls back to any permitted member when none of the preferred roles is present', async () => {
    grant('project', 'contract_administrator');
    members = [
      { userId: 'se', projectRole: 'site_engineer', user: { systemRole: 'standard_user' } },
      { userId: 'ca', projectRole: 'contract_administrator', user: { systemRole: 'standard_user' } },
    ];

    await expect(pickResponsibleMember('p1', CAP, ['commercial_manager'])).resolves.toBe('ca');
  });

  it('lists only permitted members, never the whole project team', async () => {
    grant('project', 'commercial_manager');
    members = [
      { userId: 'se', projectRole: 'site_engineer', user: { systemRole: 'standard_user' } },
      { userId: 'cm', projectRole: 'commercial_manager', user: { systemRole: 'standard_user' } },
      { userId: 'pm', projectRole: 'project_manager', user: { systemRole: 'standard_user' } },
    ];

    const holders = await listMembersWithCapability('p1', CAP);
    expect(holders.map((h) => h.userId)).toEqual(['cm']);
  });

  it('answers "nobody" when the matrix is empty, rather than falling back to code defaults', async () => {
    members = [
      { userId: 'cm', projectRole: 'commercial_manager', user: { systemRole: 'company_owner' } },
    ];

    await expect(pickResponsibleMember('p1', CAP, ['commercial_manager'])).resolves.toBeNull();
  });
});

describe('the people whose authority is the company\'s, not the project\'s', () => {
  beforeEach(() => {
    permissionRows = [];
    members = [];
    users = [];
    invalidatePermissionCache();
  });

  it('finds a managing director who is a member of nothing', async () => {
    // The live gap, found 2026-09-05. The code asked the PROJECT for its
    // directors. A managing director is not added to forty jobs one at a time,
    // so the honest answer was none — and an empty list is not an error, so
    // the MD was told about no capture at all since go-live.
    permissionRows.push({ scope: 'system', role: 'managing_director', capability: CAP });
    users = [
      { id: 'md', systemRole: 'managing_director', active: true },
      { id: 'se', systemRole: 'standard_user', active: true },
    ];
    members = [];

    await expect(listCompanyWideHolders(CAP)).resolves.toEqual(['md']);
    // And the project-scoped question still honestly answers "nobody".
    await expect(listMembersWithCapability('p1', CAP)).resolves.toEqual([]);
  });

  it('leaves out someone who has been deactivated', async () => {
    // Their authority is a fact about the past. Chasing a leaver for a
    // decision is how a task sits open until somebody deletes it by hand.
    permissionRows.push({ scope: 'system', role: 'managing_director', capability: CAP });
    users = [{ id: 'md', systemRole: 'managing_director', active: false }];

    await expect(listCompanyWideHolders(CAP)).resolves.toEqual([]);
  });

  it('returns nobody when no system role holds it at all', async () => {
    permissionRows.push({ scope: 'project', role: 'commercial_manager', capability: CAP });
    users = [{ id: 'md', systemRole: 'managing_director', active: true }];

    await expect(listCompanyWideHolders(CAP)).resolves.toEqual([]);
  });
});
