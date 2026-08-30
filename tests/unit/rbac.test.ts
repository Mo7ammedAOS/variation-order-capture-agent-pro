import { describe, expect, it } from 'vitest';
import type { ProjectRole, SystemRole } from '@prisma/client';
import {
  ALL_CAPABILITIES,
  DEFAULT_PROJECT_ROLE_CAPABILITIES,
  DEFAULT_SYSTEM_ROLE_CAPABILITIES,
  type Capability,
} from '@/lib/rbac';

/**
 * These cover the DEFAULTS — the baseline a new deployment is seeded with, and
 * what "reset to defaults" restores.
 *
 * Live authority comes from the role_permissions table via permissions.service,
 * so an admin can change any of this without a deploy. What must never change
 * is that the shipped starting point is sane: capture is open, approval is not,
 * and people outside the company get nothing.
 */

const systemHas = (role: SystemRole, capability: Capability) =>
  DEFAULT_SYSTEM_ROLE_CAPABILITIES[role].includes(capability);

const projectHas = (role: ProjectRole, capability: Capability) =>
  DEFAULT_PROJECT_ROLE_CAPABILITIES[role].includes(capability);

const combined = (
  systemRole: SystemRole,
  projectRoles: readonly ProjectRole[],
  capability: Capability,
) => systemHas(systemRole, capability) || projectRoles.some((r) => projectHas(r, capability));

describe('company-wide project reach', () => {
  it('is granted to directors and company admins', () => {
    for (const role of [
      'company_owner',
      'company_admin',
      'managing_director',
      'operations_director',
      'commercial_director',
    ] as const) {
      expect(systemHas(role, 'project.viewAll')).toBe(true);
    }
  });

  it('is NOT granted to anyone who works on projects', () => {
    for (const role of [
      'commercial_manager',
      'contract_administrator',
      'finance_manager',
      'procurement_manager',
      'standard_user',
      'viewer',
    ] as const) {
      expect(systemHas(role, 'project.viewAll')).toBe(false);
    }
  });

  it('does not let a project role grant company-wide reach', () => {
    expect(combined('standard_user', ['project_manager'], 'project.viewAll')).toBe(false);
  });
});

describe('default capabilities', () => {
  it('gives a viewer nothing', () => {
    expect(combined('viewer', [], 'potentialChange.create')).toBe(false);
    expect(combined('viewer', ['project_viewer'], 'potentialChange.create')).toBe(false);
    expect(combined('viewer', ['client_viewer'], 'document.upload')).toBe(false);
  });

  it('lets a site engineer raise a change but never assess the notice', () => {
    expect(projectHas('site_engineer', 'potentialChange.create')).toBe(true);
    expect(projectHas('site_engineer', 'potentialChange.assessNotice')).toBe(false);
    expect(combined('standard_user', ['site_engineer'], 'potentialChange.assessNotice')).toBe(false);
  });

  it('lets a commercial manager assess the notice', () => {
    expect(combined('standard_user', ['commercial_manager'], 'potentialChange.assessNotice')).toBe(
      true,
    );
    expect(systemHas('commercial_manager', 'potentialChange.assessNotice')).toBe(true);
  });

  it('takes the union across several project roles, not the intersection', () => {
    expect(combined('standard_user', ['site_engineer', 'commercial_manager'], 'task.assign')).toBe(
      true,
    );
  });

  it('keeps user management away from directors who are not admins', () => {
    expect(combined('managing_director', ['project_manager'], 'user.manage')).toBe(false);
  });
});

describe('the controlled-document split', () => {
  /**
   * The commercial point of the split: a change you did not capture is a change
   * you cannot claim, so capture stays open to everyone. Superseding a contract
   * drawing is a different act and does not.
   */
  it('lets everyone who works on site upload evidence', () => {
    for (const role of ['site_engineer', 'foreman', 'quantity_surveyor'] as const) {
      expect(projectHas(role, 'document.upload')).toBe(true);
    }
  });

  it('keeps the controlled register away from site roles', () => {
    for (const role of ['site_engineer', 'foreman'] as const) {
      expect(projectHas(role, 'document.manageRegister')).toBe(false);
    }
  });

  it('gives the register to the document controller', () => {
    expect(projectHas('document_controller', 'document.manageRegister')).toBe(true);
    expect(projectHas('document_controller', 'potentialChange.assessNotice')).toBe(false);
  });
});

describe('the capability list', () => {
  it('has no duplicates', () => {
    expect(new Set(ALL_CAPABILITIES).size).toBe(ALL_CAPABILITIES.length);
  });

  it('covers every capability the defaults hand out', () => {
    // A capability granted in the defaults but absent from ALL_CAPABILITIES
    // would be invisible on the admin screen — granted, unrevokable, unseen.
    const granted = new Set<string>();
    for (const caps of Object.values(DEFAULT_SYSTEM_ROLE_CAPABILITIES)) {
      for (const c of caps) granted.add(c);
    }
    for (const caps of Object.values(DEFAULT_PROJECT_ROLE_CAPABILITIES)) {
      for (const c of caps) granted.add(c);
    }
    for (const capability of granted) {
      expect(ALL_CAPABILITIES).toContain(capability);
    }
  });
});
