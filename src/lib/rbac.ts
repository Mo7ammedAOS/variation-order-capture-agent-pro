import type { ProjectRole, SystemRole } from '@prisma/client';

/**
 * Two independent layers of authority, and conflating them is the classic bug:
 *
 *   SYSTEM role   what you are in the company. Governs company-wide reach and
 *                 administrative powers.
 *   PROJECT role  what you do on one project. Governs the commercial actions
 *                 you may take there.
 *
 * A Managing Director sees every project by virtue of the system role. A
 * Commercial Manager sees only the projects they are a member of, and what they
 * may do there comes from the project role. Neither layer alone is sufficient.
 */

export type Capability =
  | 'project.create'
  | 'project.update'
  | 'project.viewAll'
  | 'project.manageMembers'
  | 'project.manageContractRules'
  | 'contact.manage'
  | 'document.upload'
  | 'potentialChange.create'
  | 'potentialChange.update'
  | 'potentialChange.assessNotice'
  | 'potentialChange.changeStatus'
  | 'task.assign'
  | 'task.complete'
  | 'bottleneck.manage'
  | 'user.manage'
  | 'companySettings.manage';

/** System roles that see every project without needing a membership row. */
const COMPANY_WIDE_ROLES: ReadonlySet<SystemRole> = new Set<SystemRole>([
  'company_owner',
  'company_admin',
  'managing_director',
  'operations_director',
  'commercial_director',
]);

export function hasCompanyWideProjectAccess(systemRole: SystemRole): boolean {
  return COMPANY_WIDE_ROLES.has(systemRole);
}

const ADMIN_ROLES: ReadonlySet<SystemRole> = new Set<SystemRole>([
  'company_owner',
  'company_admin',
]);

/** Capabilities granted by the system role alone, on any project in reach. */
const SYSTEM_ROLE_CAPABILITIES: Record<SystemRole, readonly Capability[]> = {
  company_owner: [
    'project.create', 'project.update', 'project.viewAll', 'project.manageMembers',
    'project.manageContractRules', 'contact.manage', 'document.upload',
    'potentialChange.create', 'potentialChange.update', 'potentialChange.assessNotice',
    'potentialChange.changeStatus', 'task.assign', 'task.complete', 'bottleneck.manage',
    'user.manage', 'companySettings.manage',
  ],
  company_admin: [
    'project.create', 'project.update', 'project.viewAll', 'project.manageMembers',
    'project.manageContractRules', 'contact.manage', 'document.upload',
    'potentialChange.create', 'potentialChange.update', 'potentialChange.assessNotice',
    'potentialChange.changeStatus', 'task.assign', 'task.complete', 'bottleneck.manage',
    'user.manage', 'companySettings.manage',
  ],
  managing_director: [
    'project.create', 'project.update', 'project.viewAll', 'project.manageMembers',
    'project.manageContractRules', 'contact.manage', 'document.upload',
    'potentialChange.update', 'potentialChange.assessNotice', 'potentialChange.changeStatus',
    'task.assign', 'task.complete', 'bottleneck.manage',
  ],
  operations_director: [
    'project.create', 'project.update', 'project.viewAll', 'project.manageMembers',
    'contact.manage', 'document.upload', 'potentialChange.update',
    'potentialChange.changeStatus', 'task.assign', 'task.complete', 'bottleneck.manage',
  ],
  commercial_director: [
    'project.viewAll', 'project.update', 'project.manageContractRules', 'contact.manage',
    'document.upload', 'potentialChange.update', 'potentialChange.assessNotice',
    'potentialChange.changeStatus', 'task.assign', 'task.complete', 'bottleneck.manage',
  ],
  commercial_manager: [
    'project.manageContractRules', 'contact.manage', 'document.upload',
    'potentialChange.create', 'potentialChange.update', 'potentialChange.assessNotice',
    'potentialChange.changeStatus', 'task.assign', 'task.complete', 'bottleneck.manage',
  ],
  contract_administrator: [
    'contact.manage', 'document.upload', 'potentialChange.create', 'potentialChange.update',
    'potentialChange.assessNotice', 'task.assign', 'task.complete', 'bottleneck.manage',
  ],
  finance_manager: ['document.upload', 'task.complete'],
  procurement_manager: ['document.upload', 'potentialChange.update', 'task.complete'],
  standard_user: [
    'document.upload', 'potentialChange.create', 'potentialChange.update', 'task.complete',
  ],
  viewer: [],
};

/** Extra capabilities a project role grants on that project only. */
const PROJECT_ROLE_CAPABILITIES: Record<ProjectRole, readonly Capability[]> = {
  project_manager: [
    'project.update', 'project.manageMembers', 'contact.manage', 'document.upload',
    'potentialChange.create', 'potentialChange.update', 'potentialChange.changeStatus',
    'task.assign', 'task.complete', 'bottleneck.manage',
  ],
  quantity_surveyor: [
    'document.upload', 'potentialChange.create', 'potentialChange.update',
    'potentialChange.changeStatus', 'task.complete',
  ],
  site_engineer: ['document.upload', 'potentialChange.create', 'task.complete'],
  foreman: ['document.upload', 'potentialChange.create', 'task.complete'],
  commercial_manager: [
    'project.manageContractRules', 'contact.manage', 'document.upload',
    'potentialChange.create', 'potentialChange.update', 'potentialChange.assessNotice',
    'potentialChange.changeStatus', 'task.assign', 'task.complete', 'bottleneck.manage',
  ],
  contract_administrator: [
    'contact.manage', 'document.upload', 'potentialChange.create', 'potentialChange.update',
    'potentialChange.assessNotice', 'task.assign', 'task.complete',
  ],
  procurement_officer: ['document.upload', 'potentialChange.update', 'task.complete'],
  planning_engineer: ['document.upload', 'potentialChange.update', 'task.complete'],
  finance_officer: ['document.upload', 'task.complete'],
  document_controller: ['document.upload', 'task.complete'],
  project_viewer: [],
  client_viewer: [],
  consultant_viewer: [],
};

export function systemRoleHasCapability(role: SystemRole, capability: Capability): boolean {
  return SYSTEM_ROLE_CAPABILITIES[role].includes(capability);
}

export function projectRoleHasCapability(role: ProjectRole, capability: Capability): boolean {
  return PROJECT_ROLE_CAPABILITIES[role].includes(capability);
}

/**
 * The combined check. Membership in ANY project role that grants the capability
 * is enough — a person who is both QS and Contract Administrator on a project
 * gets the union, not the intersection.
 */
export function hasCapability(
  systemRole: SystemRole,
  projectRoles: readonly ProjectRole[],
  capability: Capability,
): boolean {
  if (systemRoleHasCapability(systemRole, capability)) return true;
  return projectRoles.some((role) => projectRoleHasCapability(role, capability));
}

export function isCompanyAdmin(systemRole: SystemRole): boolean {
  return ADMIN_ROLES.has(systemRole);
}

export const SYSTEM_ROLE_LABELS: Record<SystemRole, string> = {
  company_owner: 'Company Owner',
  company_admin: 'Company Admin',
  managing_director: 'Managing Director',
  operations_director: 'Operations Director',
  commercial_director: 'Commercial Director',
  commercial_manager: 'Commercial Manager',
  contract_administrator: 'Contract Administrator',
  finance_manager: 'Finance Manager',
  procurement_manager: 'Procurement Manager',
  standard_user: 'Standard User',
  viewer: 'Viewer',
};

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  project_manager: 'Project Manager',
  quantity_surveyor: 'Quantity Surveyor',
  site_engineer: 'Site Engineer',
  foreman: 'Foreman',
  commercial_manager: 'Commercial Manager',
  contract_administrator: 'Contract Administrator',
  procurement_officer: 'Procurement Officer',
  planning_engineer: 'Planning Engineer',
  finance_officer: 'Finance Officer',
  document_controller: 'Document Controller',
  project_viewer: 'Project Viewer',
  client_viewer: 'Client Viewer',
  consultant_viewer: 'Consultant Viewer',
};
