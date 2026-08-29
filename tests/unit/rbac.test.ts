import { describe, expect, it } from 'vitest';
import {
  hasCapability,
  hasCompanyWideProjectAccess,
  isCompanyAdmin,
  projectRoleHasCapability,
  systemRoleHasCapability,
} from '@/lib/rbac';

describe('company-wide project reach', () => {
  it('is granted to directors and company admins', () => {
    for (const role of [
      'company_owner',
      'company_admin',
      'managing_director',
      'operations_director',
      'commercial_director',
    ] as const) {
      expect(hasCompanyWideProjectAccess(role)).toBe(true);
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
      expect(hasCompanyWideProjectAccess(role)).toBe(false);
    }
  });
});

describe('capabilities', () => {
  it('lets a Managing Director see everything without a membership', () => {
    expect(systemRoleHasCapability('managing_director', 'project.viewAll')).toBe(true);
  });

  it('gives a viewer nothing', () => {
    expect(hasCapability('viewer', [], 'potentialChange.create')).toBe(false);
    expect(hasCapability('viewer', ['project_viewer'], 'potentialChange.create')).toBe(false);
    expect(hasCapability('viewer', ['client_viewer'], 'document.upload')).toBe(false);
  });

  it('lets a site engineer raise a change but never assess the notice', () => {
    expect(projectRoleHasCapability('site_engineer', 'potentialChange.create')).toBe(true);
    expect(projectRoleHasCapability('site_engineer', 'potentialChange.assessNotice')).toBe(false);
    expect(hasCapability('standard_user', ['site_engineer'], 'potentialChange.assessNotice')).toBe(
      false,
    );
  });

  it('lets a commercial manager assess the notice', () => {
    expect(hasCapability('standard_user', ['commercial_manager'], 'potentialChange.assessNotice')).toBe(
      true,
    );
    expect(systemRoleHasCapability('commercial_manager', 'potentialChange.assessNotice')).toBe(true);
  });

  it('takes the union across several project roles, not the intersection', () => {
    expect(
      hasCapability('standard_user', ['site_engineer', 'commercial_manager'], 'task.assign'),
    ).toBe(true);
  });

  it('keeps user management to company admins', () => {
    expect(isCompanyAdmin('company_admin')).toBe(true);
    expect(isCompanyAdmin('managing_director')).toBe(false);
    expect(hasCapability('managing_director', ['project_manager'], 'user.manage')).toBe(false);
  });

  it('does not let a project role grant company-wide reach', () => {
    expect(hasCapability('standard_user', ['project_manager'], 'project.viewAll')).toBe(false);
  });
});
