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

vi.mock('@/lib/prisma', () => ({
  prisma: {
    rolePermission: { findMany: async () => permissionRows },
    projectMember: { findMany: async () => members },
  },
}));

vi.mock('server-only', () => ({}));

const { pickResponsibleMember, listMembersWithCapability, invalidatePermissionCache } =
  await import('@/services/permissions.service');

const CAP = 'potentialChange.assessNotice';

function grant(scope: 'system' | 'project', role: string) {
  permissionRows.push({ scope, role, capability: CAP });
}

describe('routing work to someone who may actually do it', () => {
  beforeEach(() => {
    permissionRows = [];
    members = [];
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
