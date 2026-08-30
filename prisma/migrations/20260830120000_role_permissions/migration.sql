-- Authority becomes data, and company administration becomes a flag.
--
-- Two separate problems, one migration, because the second is meaningless
-- without the first: an admin screen for permissions needs someone who is
-- reliably an admin.

-- ── 1. Company administration, separate from job ───────────────────────────
--
-- systemRole is a single column, so a Finance Manager who administers the app
-- had to stop being recorded as a Finance Manager. Administration is chosen by
-- the company and has nothing to do with what the person does.
ALTER TABLE "users"
  ADD COLUMN "can_administer_company" BOOLEAN NOT NULL DEFAULT false;

-- Preserve exactly the authority that exists today: whoever the old ADMIN_ROLES
-- set covered keeps it, and nobody silently gains or loses access.
UPDATE "users"
   SET "can_administer_company" = true
 WHERE "system_role" IN ('company_owner', 'company_admin');

CREATE INDEX "users_can_administer_company_idx"
    ON "users" ("can_administer_company");

-- A deployment with no administrator cannot invite anyone, cannot change a
-- permission, and cannot recover without a database client. Promote the most
-- senior person present rather than leaving that state reachable.
UPDATE "users"
   SET "can_administer_company" = true
 WHERE "id" = (
   SELECT "id" FROM "users"
    WHERE "active" = true
    ORDER BY CASE "system_role"
               WHEN 'company_owner'       THEN 1
               WHEN 'company_admin'       THEN 2
               WHEN 'managing_director'   THEN 3
               WHEN 'operations_director' THEN 4
               WHEN 'commercial_director' THEN 5
               ELSE 6
             END, "created_at"
    LIMIT 1
 )
   AND NOT EXISTS (SELECT 1 FROM "users" WHERE "can_administer_company" = true);

-- ── 2. The capability matrix, as rows ──────────────────────────────────────
CREATE TYPE "RoleScope" AS ENUM ('system', 'project');

CREATE TABLE "role_permissions" (
  "id"                 UUID         NOT NULL DEFAULT gen_random_uuid(),
  "scope"              "RoleScope"  NOT NULL,
  "role"               TEXT         NOT NULL,
  "capability"         TEXT         NOT NULL,
  "granted"            BOOLEAN      NOT NULL DEFAULT true,
  "updated_by_user_id" UUID,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "role_permissions_scope_role_capability_key"
    ON "role_permissions" ("scope", "role", "capability");
CREATE INDEX "role_permissions_scope_role_idx"
    ON "role_permissions" ("scope", "role");

-- The defaults previously hardcoded in src/lib/rbac.ts, transcribed verbatim by
-- a script reading those constants, so this migration cannot drift from them.
--
-- A missing row is a DENIAL, not a fallback to code. That is the whole point:
-- a permission an admin revokes must not reappear on the next deploy.
INSERT INTO "role_permissions" ("scope", "role", "capability", "updated_at") VALUES
  ('system', 'company_owner', 'project.create', CURRENT_TIMESTAMP),
  ('system', 'company_owner', 'project.update', CURRENT_TIMESTAMP),
  ('system', 'company_owner', 'project.viewAll', CURRENT_TIMESTAMP),
  ('system', 'company_owner', 'project.manageMembers', CURRENT_TIMESTAMP),
  ('system', 'company_owner', 'project.manageContractRules', CURRENT_TIMESTAMP),
  ('system', 'company_owner', 'contact.manage', CURRENT_TIMESTAMP),
  ('system', 'company_owner', 'document.upload', CURRENT_TIMESTAMP),
  ('system', 'company_owner', 'document.manageRegister', CURRENT_TIMESTAMP),
  ('system', 'company_owner', 'potentialChange.create', CURRENT_TIMESTAMP),
  ('system', 'company_owner', 'potentialChange.update', CURRENT_TIMESTAMP),
  ('system', 'company_owner', 'potentialChange.assessNotice', CURRENT_TIMESTAMP),
  ('system', 'company_owner', 'potentialChange.changeStatus', CURRENT_TIMESTAMP),
  ('system', 'company_owner', 'task.assign', CURRENT_TIMESTAMP),
  ('system', 'company_owner', 'task.complete', CURRENT_TIMESTAMP),
  ('system', 'company_owner', 'bottleneck.manage', CURRENT_TIMESTAMP),
  ('system', 'company_owner', 'user.manage', CURRENT_TIMESTAMP),
  ('system', 'company_owner', 'companySettings.manage', CURRENT_TIMESTAMP),
  ('system', 'company_admin', 'project.create', CURRENT_TIMESTAMP),
  ('system', 'company_admin', 'project.update', CURRENT_TIMESTAMP),
  ('system', 'company_admin', 'project.viewAll', CURRENT_TIMESTAMP),
  ('system', 'company_admin', 'project.manageMembers', CURRENT_TIMESTAMP),
  ('system', 'company_admin', 'project.manageContractRules', CURRENT_TIMESTAMP),
  ('system', 'company_admin', 'contact.manage', CURRENT_TIMESTAMP),
  ('system', 'company_admin', 'document.upload', CURRENT_TIMESTAMP),
  ('system', 'company_admin', 'document.manageRegister', CURRENT_TIMESTAMP),
  ('system', 'company_admin', 'potentialChange.create', CURRENT_TIMESTAMP),
  ('system', 'company_admin', 'potentialChange.update', CURRENT_TIMESTAMP),
  ('system', 'company_admin', 'potentialChange.assessNotice', CURRENT_TIMESTAMP),
  ('system', 'company_admin', 'potentialChange.changeStatus', CURRENT_TIMESTAMP),
  ('system', 'company_admin', 'task.assign', CURRENT_TIMESTAMP),
  ('system', 'company_admin', 'task.complete', CURRENT_TIMESTAMP),
  ('system', 'company_admin', 'bottleneck.manage', CURRENT_TIMESTAMP),
  ('system', 'company_admin', 'user.manage', CURRENT_TIMESTAMP),
  ('system', 'company_admin', 'companySettings.manage', CURRENT_TIMESTAMP),
  ('system', 'managing_director', 'project.create', CURRENT_TIMESTAMP),
  ('system', 'managing_director', 'project.update', CURRENT_TIMESTAMP),
  ('system', 'managing_director', 'project.viewAll', CURRENT_TIMESTAMP),
  ('system', 'managing_director', 'project.manageMembers', CURRENT_TIMESTAMP),
  ('system', 'managing_director', 'project.manageContractRules', CURRENT_TIMESTAMP),
  ('system', 'managing_director', 'contact.manage', CURRENT_TIMESTAMP),
  ('system', 'managing_director', 'document.upload', CURRENT_TIMESTAMP),
  ('system', 'managing_director', 'document.manageRegister', CURRENT_TIMESTAMP),
  ('system', 'managing_director', 'potentialChange.update', CURRENT_TIMESTAMP),
  ('system', 'managing_director', 'potentialChange.assessNotice', CURRENT_TIMESTAMP),
  ('system', 'managing_director', 'potentialChange.changeStatus', CURRENT_TIMESTAMP),
  ('system', 'managing_director', 'task.assign', CURRENT_TIMESTAMP),
  ('system', 'managing_director', 'task.complete', CURRENT_TIMESTAMP),
  ('system', 'managing_director', 'bottleneck.manage', CURRENT_TIMESTAMP),
  ('system', 'operations_director', 'project.create', CURRENT_TIMESTAMP),
  ('system', 'operations_director', 'project.update', CURRENT_TIMESTAMP),
  ('system', 'operations_director', 'project.viewAll', CURRENT_TIMESTAMP),
  ('system', 'operations_director', 'project.manageMembers', CURRENT_TIMESTAMP),
  ('system', 'operations_director', 'contact.manage', CURRENT_TIMESTAMP),
  ('system', 'operations_director', 'document.upload', CURRENT_TIMESTAMP),
  ('system', 'operations_director', 'document.manageRegister', CURRENT_TIMESTAMP),
  ('system', 'operations_director', 'potentialChange.update', CURRENT_TIMESTAMP),
  ('system', 'operations_director', 'potentialChange.changeStatus', CURRENT_TIMESTAMP),
  ('system', 'operations_director', 'task.assign', CURRENT_TIMESTAMP),
  ('system', 'operations_director', 'task.complete', CURRENT_TIMESTAMP),
  ('system', 'operations_director', 'bottleneck.manage', CURRENT_TIMESTAMP),
  ('system', 'commercial_director', 'project.viewAll', CURRENT_TIMESTAMP),
  ('system', 'commercial_director', 'project.update', CURRENT_TIMESTAMP),
  ('system', 'commercial_director', 'project.manageContractRules', CURRENT_TIMESTAMP),
  ('system', 'commercial_director', 'contact.manage', CURRENT_TIMESTAMP),
  ('system', 'commercial_director', 'document.upload', CURRENT_TIMESTAMP),
  ('system', 'commercial_director', 'document.manageRegister', CURRENT_TIMESTAMP),
  ('system', 'commercial_director', 'potentialChange.update', CURRENT_TIMESTAMP),
  ('system', 'commercial_director', 'potentialChange.assessNotice', CURRENT_TIMESTAMP),
  ('system', 'commercial_director', 'potentialChange.changeStatus', CURRENT_TIMESTAMP),
  ('system', 'commercial_director', 'task.assign', CURRENT_TIMESTAMP),
  ('system', 'commercial_director', 'task.complete', CURRENT_TIMESTAMP),
  ('system', 'commercial_director', 'bottleneck.manage', CURRENT_TIMESTAMP),
  ('system', 'commercial_manager', 'project.manageContractRules', CURRENT_TIMESTAMP),
  ('system', 'commercial_manager', 'contact.manage', CURRENT_TIMESTAMP),
  ('system', 'commercial_manager', 'document.upload', CURRENT_TIMESTAMP),
  ('system', 'commercial_manager', 'document.manageRegister', CURRENT_TIMESTAMP),
  ('system', 'commercial_manager', 'potentialChange.create', CURRENT_TIMESTAMP),
  ('system', 'commercial_manager', 'potentialChange.update', CURRENT_TIMESTAMP),
  ('system', 'commercial_manager', 'potentialChange.assessNotice', CURRENT_TIMESTAMP),
  ('system', 'commercial_manager', 'potentialChange.changeStatus', CURRENT_TIMESTAMP),
  ('system', 'commercial_manager', 'task.assign', CURRENT_TIMESTAMP),
  ('system', 'commercial_manager', 'task.complete', CURRENT_TIMESTAMP),
  ('system', 'commercial_manager', 'bottleneck.manage', CURRENT_TIMESTAMP),
  ('system', 'contract_administrator', 'contact.manage', CURRENT_TIMESTAMP),
  ('system', 'contract_administrator', 'document.upload', CURRENT_TIMESTAMP),
  ('system', 'contract_administrator', 'document.manageRegister', CURRENT_TIMESTAMP),
  ('system', 'contract_administrator', 'potentialChange.create', CURRENT_TIMESTAMP),
  ('system', 'contract_administrator', 'potentialChange.update', CURRENT_TIMESTAMP),
  ('system', 'contract_administrator', 'potentialChange.assessNotice', CURRENT_TIMESTAMP),
  ('system', 'contract_administrator', 'task.assign', CURRENT_TIMESTAMP),
  ('system', 'contract_administrator', 'task.complete', CURRENT_TIMESTAMP),
  ('system', 'contract_administrator', 'bottleneck.manage', CURRENT_TIMESTAMP),
  ('system', 'finance_manager', 'document.upload', CURRENT_TIMESTAMP),
  ('system', 'finance_manager', 'task.complete', CURRENT_TIMESTAMP),
  ('system', 'procurement_manager', 'document.upload', CURRENT_TIMESTAMP),
  ('system', 'procurement_manager', 'potentialChange.update', CURRENT_TIMESTAMP),
  ('system', 'procurement_manager', 'task.complete', CURRENT_TIMESTAMP),
  ('system', 'standard_user', 'document.upload', CURRENT_TIMESTAMP),
  ('system', 'standard_user', 'potentialChange.create', CURRENT_TIMESTAMP),
  ('system', 'standard_user', 'potentialChange.update', CURRENT_TIMESTAMP),
  ('system', 'standard_user', 'task.complete', CURRENT_TIMESTAMP),
  ('project', 'project_manager', 'project.update', CURRENT_TIMESTAMP),
  ('project', 'project_manager', 'project.manageMembers', CURRENT_TIMESTAMP),
  ('project', 'project_manager', 'contact.manage', CURRENT_TIMESTAMP),
  ('project', 'project_manager', 'document.upload', CURRENT_TIMESTAMP),
  ('project', 'project_manager', 'document.manageRegister', CURRENT_TIMESTAMP),
  ('project', 'project_manager', 'potentialChange.create', CURRENT_TIMESTAMP),
  ('project', 'project_manager', 'potentialChange.update', CURRENT_TIMESTAMP),
  ('project', 'project_manager', 'potentialChange.changeStatus', CURRENT_TIMESTAMP),
  ('project', 'project_manager', 'task.assign', CURRENT_TIMESTAMP),
  ('project', 'project_manager', 'task.complete', CURRENT_TIMESTAMP),
  ('project', 'project_manager', 'bottleneck.manage', CURRENT_TIMESTAMP),
  ('project', 'quantity_surveyor', 'document.upload', CURRENT_TIMESTAMP),
  ('project', 'quantity_surveyor', 'potentialChange.create', CURRENT_TIMESTAMP),
  ('project', 'quantity_surveyor', 'potentialChange.update', CURRENT_TIMESTAMP),
  ('project', 'quantity_surveyor', 'potentialChange.changeStatus', CURRENT_TIMESTAMP),
  ('project', 'quantity_surveyor', 'task.complete', CURRENT_TIMESTAMP),
  ('project', 'site_engineer', 'document.upload', CURRENT_TIMESTAMP),
  ('project', 'site_engineer', 'potentialChange.create', CURRENT_TIMESTAMP),
  ('project', 'site_engineer', 'task.complete', CURRENT_TIMESTAMP),
  ('project', 'foreman', 'document.upload', CURRENT_TIMESTAMP),
  ('project', 'foreman', 'potentialChange.create', CURRENT_TIMESTAMP),
  ('project', 'foreman', 'task.complete', CURRENT_TIMESTAMP),
  ('project', 'commercial_manager', 'project.manageContractRules', CURRENT_TIMESTAMP),
  ('project', 'commercial_manager', 'contact.manage', CURRENT_TIMESTAMP),
  ('project', 'commercial_manager', 'document.upload', CURRENT_TIMESTAMP),
  ('project', 'commercial_manager', 'potentialChange.create', CURRENT_TIMESTAMP),
  ('project', 'commercial_manager', 'potentialChange.update', CURRENT_TIMESTAMP),
  ('project', 'commercial_manager', 'potentialChange.assessNotice', CURRENT_TIMESTAMP),
  ('project', 'commercial_manager', 'potentialChange.changeStatus', CURRENT_TIMESTAMP),
  ('project', 'commercial_manager', 'task.assign', CURRENT_TIMESTAMP),
  ('project', 'commercial_manager', 'task.complete', CURRENT_TIMESTAMP),
  ('project', 'commercial_manager', 'bottleneck.manage', CURRENT_TIMESTAMP),
  ('project', 'contract_administrator', 'contact.manage', CURRENT_TIMESTAMP),
  ('project', 'contract_administrator', 'document.upload', CURRENT_TIMESTAMP),
  ('project', 'contract_administrator', 'potentialChange.create', CURRENT_TIMESTAMP),
  ('project', 'contract_administrator', 'potentialChange.update', CURRENT_TIMESTAMP),
  ('project', 'contract_administrator', 'potentialChange.assessNotice', CURRENT_TIMESTAMP),
  ('project', 'contract_administrator', 'task.assign', CURRENT_TIMESTAMP),
  ('project', 'contract_administrator', 'task.complete', CURRENT_TIMESTAMP),
  ('project', 'procurement_officer', 'document.upload', CURRENT_TIMESTAMP),
  ('project', 'procurement_officer', 'potentialChange.update', CURRENT_TIMESTAMP),
  ('project', 'procurement_officer', 'task.complete', CURRENT_TIMESTAMP),
  ('project', 'planning_engineer', 'document.upload', CURRENT_TIMESTAMP),
  ('project', 'planning_engineer', 'potentialChange.update', CURRENT_TIMESTAMP),
  ('project', 'planning_engineer', 'task.complete', CURRENT_TIMESTAMP),
  ('project', 'finance_officer', 'document.upload', CURRENT_TIMESTAMP),
  ('project', 'finance_officer', 'task.complete', CURRENT_TIMESTAMP),
  ('project', 'document_controller', 'document.upload', CURRENT_TIMESTAMP),
  ('project', 'document_controller', 'document.manageRegister', CURRENT_TIMESTAMP),
  ('project', 'document_controller', 'task.complete', CURRENT_TIMESTAMP);
