import type { ProjectRole, SystemRole } from '@prisma/client';

/**
 * Capability NAMES, DEFAULTS and LABELS only.
 *
 * The runtime answer to "may this person do this" lives in
 * services/permissions.service.ts, reading the role_permissions table. It is
 * deliberately not re-exported here: a synchronous copy reading the constants
 * below would drift from what the admin has actually set, and the way that
 * shows up is a page offering a button the service then refuses — or worse,
 * hiding one the person is entitled to.
 */

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

export const ALL_CAPABILITIES = [
  'project.create',
  'project.update',
  'project.viewAll',
  'project.manageMembers',
  'project.manageContractRules',
  'contact.manage',
  'document.upload',
  'document.manageRegister',
  'potentialChange.create',
  'potentialChange.update',
  'potentialChange.updateOwn',
  'potentialChange.reopen',
  'potentialChange.assessNotice',
  'notice.draft',
  'notice.acknowledge',
  'variationOrder.manage',
  'invoice.manage',
  'payment.record',
  'potentialChange.changeStatus',
  'approval.projectManager',
  'approval.managingDirector',
  'potentialChange.cancel',
  'pricing.submit',
  'task.assign',
  'task.complete',
  'bottleneck.manage',
  'user.manage',
  'companySettings.manage',
] as const;

/**
 * Derived from the list above rather than written out again.
 *
 * The two were maintained by hand and drifted the moment a capability was
 * added: the array had it, the union did not, and the permissions screen
 * stopped compiling with an error that named a type rather than the omission.
 * Deriving it means a new capability is one edit, in one place.
 */
export type Capability = (typeof ALL_CAPABILITIES)[number];

/**
 * THE DEFAULTS ONLY — not the live matrix.
 *
 * Authority is now read from the `role_permissions` table so an admin can set
 * it without a deploy. These constants are the baseline a new deployment is
 * seeded with, and the reference for what "reset to defaults" restores.
 *
 * Nothing at runtime should consult these. Use permissions.service.ts.
 */
export const DEFAULT_SYSTEM_ROLE_CAPABILITIES: Record<SystemRole, readonly Capability[]> = {
  company_owner: [
    'project.create', 'project.update', 'project.viewAll', 'project.manageMembers',
    'project.manageContractRules', 'contact.manage', 'document.upload', 'document.manageRegister',
    'potentialChange.create', 'potentialChange.update', 'potentialChange.assessNotice',
    'notice.draft', 'notice.acknowledge',
    'variationOrder.manage', 'invoice.manage', 'payment.record',
    'potentialChange.changeStatus', 'task.assign', 'task.complete', 'bottleneck.manage',
    'user.manage', 'companySettings.manage',
  ],
  company_admin: [
    'project.create', 'project.update', 'project.viewAll', 'project.manageMembers',
    'project.manageContractRules', 'contact.manage', 'document.upload', 'document.manageRegister',
    'potentialChange.create', 'potentialChange.update', 'potentialChange.assessNotice',
    'notice.draft', 'notice.acknowledge',
    'variationOrder.manage', 'invoice.manage', 'payment.record',
    'potentialChange.changeStatus', 'task.assign', 'task.complete', 'bottleneck.manage',
    'user.manage', 'companySettings.manage',
  ],
  managing_director: [
    'project.create', 'project.update', 'project.viewAll', 'project.manageMembers',
    'project.manageContractRules', 'contact.manage', 'document.upload', 'document.manageRegister',
    'potentialChange.update', 'potentialChange.assessNotice', 'potentialChange.changeStatus',
    'notice.draft', 'notice.acknowledge',
    'variationOrder.manage', 'invoice.manage', 'payment.record',
    'task.assign', 'task.complete', 'bottleneck.manage',
  ],
  operations_director: [
    'project.create', 'project.update', 'project.viewAll', 'project.manageMembers',
    'contact.manage', 'document.upload', 'document.manageRegister', 'potentialChange.update',
    'potentialChange.changeStatus', 'task.assign', 'task.complete', 'bottleneck.manage',
  ],
  commercial_director: [
    'project.viewAll', 'project.update', 'project.manageContractRules', 'contact.manage',
    'document.upload', 'document.manageRegister', 'potentialChange.update', 'potentialChange.assessNotice',
    'notice.draft', 'notice.acknowledge',
    'variationOrder.manage', 'invoice.manage', 'payment.record',
    'potentialChange.changeStatus', 'task.assign', 'task.complete', 'bottleneck.manage',
  ],
  commercial_manager: [
    'project.manageContractRules', 'contact.manage', 'document.upload', 'document.manageRegister',
    'potentialChange.create', 'potentialChange.update', 'potentialChange.assessNotice',
    'notice.draft', 'notice.acknowledge',
    'variationOrder.manage', 'invoice.manage',
    'potentialChange.changeStatus', 'task.assign', 'task.complete', 'bottleneck.manage',
  ],
  contract_administrator: [
    'contact.manage', 'document.upload', 'document.manageRegister', 'potentialChange.create', 'potentialChange.update',
    'potentialChange.assessNotice', 'notice.draft', 'notice.acknowledge',
    'task.assign', 'task.complete', 'bottleneck.manage',
  ],
  finance_manager: [
    'document.upload', 'task.complete', 'invoice.manage', 'payment.record',
  ],
  procurement_manager: ['document.upload', 'potentialChange.update', 'task.complete'],
  standard_user: [
    'document.upload', 'potentialChange.create', 'potentialChange.update', 'task.complete',
  ],
  viewer: [],
};

/** Defaults for project roles. See the note above — seed data, not runtime. */
export const DEFAULT_PROJECT_ROLE_CAPABILITIES: Record<ProjectRole, readonly Capability[]> = {
  project_manager: [
    'project.update', 'project.manageMembers', 'contact.manage', 'document.upload',
    'document.manageRegister',
    'potentialChange.create', 'potentialChange.update', 'potentialChange.changeStatus',
    'notice.draft', 'notice.acknowledge', 'variationOrder.manage',
    'task.assign', 'task.complete', 'bottleneck.manage',
  ],
  quantity_surveyor: [
    'document.upload', 'potentialChange.create', 'potentialChange.update',
    'potentialChange.changeStatus', 'variationOrder.manage', 'task.complete',
  ],
  site_engineer: ['document.upload', 'potentialChange.create', 'task.complete'],
  foreman: ['document.upload', 'potentialChange.create', 'task.complete'],
  commercial_manager: [
    'project.manageContractRules', 'contact.manage', 'document.upload',
    'potentialChange.create', 'potentialChange.update', 'potentialChange.assessNotice',
    'notice.draft', 'notice.acknowledge', 'variationOrder.manage', 'invoice.manage',
    'potentialChange.changeStatus', 'task.assign', 'task.complete', 'bottleneck.manage',
  ],
  contract_administrator: [
    'contact.manage', 'document.upload', 'potentialChange.create', 'potentialChange.update',
    'potentialChange.assessNotice', 'notice.draft', 'notice.acknowledge',
    'variationOrder.manage',
    'task.assign', 'task.complete',
  ],
  procurement_officer: ['document.upload', 'potentialChange.update', 'task.complete'],
  planning_engineer: ['document.upload', 'potentialChange.update', 'task.complete'],
  finance_officer: [
    'document.upload', 'task.complete', 'invoice.manage', 'payment.record',
  ],
  document_controller: ['document.upload', 'document.manageRegister', 'task.complete'],
  project_viewer: [],
  client_viewer: [],
  consultant_viewer: [],
};

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

/**
 * Who should be offered the entitlement question first, where more than one
 * person on a project is permitted to answer it.
 *
 * Preference, not permission. Permission is the matrix; this only breaks a tie
 * between people who already hold it. Commercial Manager first because
 * entitlement is their trade, Contract Administrator next, and the Project
 * Manager last — many fit-out contractors run projects without a commercial
 * manager at all, and on those the PM is the decision.
 */
export const NOTICE_ASSESSMENT_PREFERENCE: ProjectRole[] = [
  'commercial_manager',
  'contract_administrator',
  'project_manager',
];
