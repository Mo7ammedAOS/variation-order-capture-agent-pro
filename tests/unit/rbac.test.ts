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

describe('who may serve a notice', () => {
  // Osman's call, 2026-09-04. The administrator sets the system up — accounts,
  // projects, documents, contract rules. A notice is not set-up: it is a
  // contractual act served in the company's name, and the person who signs it
  // has to be the person who assessed it.
  it('is not the company administrator', () => {
    expect(systemHas('company_admin', 'notice.draft')).toBe(false);
    expect(systemHas('company_admin', 'notice.acknowledge')).toBe(false);
    expect(systemHas('company_admin', 'potentialChange.assessNotice')).toBe(false);
  });

  it('is still everything else the administrator does', () => {
    // Removing the notice must not have removed the job.
    for (const capability of [
      'user.manage', 'project.create', 'project.update', 'project.manageMembers',
      'project.manageContractRules', 'document.upload', 'document.manageRegister',
    ] as const) {
      expect(systemHas('company_admin', capability)).toBe(true);
    }
  });

  it('is the managing director and the company owner', () => {
    expect(systemHas('managing_director', 'notice.draft')).toBe(true);
    expect(systemHas('company_owner', 'notice.draft')).toBe(true);
  });
});

describe('correcting a report', () => {
  it('lets the site engineer fix his own and nobody else’s', () => {
    // The person who was standing there is the only one who can say what
    // actually happened. Making him ask a project manager to fix a mistyped
    // date is how the correction never gets made.
    //
    // Granted on the PROJECT role, not the system role: the authority to
    // correct a report belongs to the job he is on, and a site engineer
    // assigned to nothing should hold nothing.
    expect(projectHas('site_engineer', 'potentialChange.updateOwn')).toBe(true);
    expect(projectHas('site_engineer', 'potentialChange.update')).toBe(false);
    expect(projectHas('foreman', 'potentialChange.updateOwn')).toBe(true);
  });

  it('lets the managing director fix anyone’s', () => {
    expect(systemHas('managing_director', 'potentialChange.update')).toBe(true);
  });
});

describe('who decides whether a notice is required', () => {
  it('gives it to the project manager, because routing goes looking for holders', () => {
    // The live failure of 2026-09-05: two changes captured on two projects and
    // neither project manager got the assessment task. Work is routed to the
    // members who HOLD this capability — never by job title — so a project
    // staffed with a PM, a QS and site engineers produced an EMPTY holder
    // list, the change was created unowned, and the task landed in nobody's
    // My Tasks while the notice clock ran on.
    expect(projectHas('project_manager', 'potentialChange.assessNotice')).toBe(true);
  });

  it('keeps the commercial roles holding it too', () => {
    expect(projectHas('commercial_manager', 'potentialChange.assessNotice')).toBe(true);
    expect(projectHas('contract_administrator', 'potentialChange.assessNotice')).toBe(true);
  });

  it('never gives it to the people who only report', () => {
    expect(projectHas('site_engineer', 'potentialChange.assessNotice')).toBe(false);
    expect(projectHas('foreman', 'potentialChange.assessNotice')).toBe(false);
    expect(projectHas('quantity_surveyor', 'potentialChange.assessNotice')).toBe(false);
  });

  it('keeps the administrator away from notices altogether', () => {
    // Osman's call, 2026-09-04. Setting the system up and serving a
    // contractual document in the company's name are different acts.
    expect(systemHas('company_admin', 'potentialChange.assessNotice')).toBe(false);
    expect(systemHas('company_admin', 'notice.draft')).toBe(false);
    expect(systemHas('company_admin', 'notice.acknowledge')).toBe(false);
  });
});

describe('deleting a change permanently', () => {
  it('belongs to the people who answer for the company', () => {
    expect(systemHas('company_owner', 'potentialChange.delete')).toBe(true);
    expect(systemHas('company_admin', 'potentialChange.delete')).toBe(true);
    expect(systemHas('managing_director', 'potentialChange.delete')).toBe(true);
  });

  it('is held by no project role at all', () => {
    // The value of the record is that the people working the project cannot
    // make it disappear. A PM under pressure to explain a missed deadline is
    // exactly who this is kept away from.
    for (const role of Object.keys(DEFAULT_PROJECT_ROLE_CAPABILITIES) as ProjectRole[]) {
      expect(projectHas(role, 'potentialChange.delete'), role).toBe(false);
    }
  });

  it('is not implied by being allowed to cancel', () => {
    // Cancelling keeps the trail; deleting destroys it. Two different rights,
    // and the commercial roles hold only the first.
    expect(systemHas('commercial_manager', 'potentialChange.delete')).toBe(false);
    expect(systemHas('contract_administrator', 'potentialChange.delete')).toBe(false);
    expect(systemHas('standard_user', 'potentialChange.delete')).toBe(false);
  });
});
