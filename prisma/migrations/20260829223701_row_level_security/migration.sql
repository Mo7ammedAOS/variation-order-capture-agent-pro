-- Promoted from prisma/sql/002_rls.sql on 2026-08-30.
--
-- This is the one that mattered. Applied out of band, a database rebuilt
-- from `migrate deploy` came up with ROW LEVEL SECURITY DISABLED and not
-- one policy — and nothing would have failed or warned. The anon key would
-- simply have read everything. Security that depends on someone remembering
-- to run a script is not security.
--
-- Every statement is idempotent (DROP POLICY IF EXISTS before each CREATE).

-- Row level security.
--
-- ══════════════════════════════════════════════════════════════════════════
--  READ THIS BEFORE TRUSTING IT.
--
--  Prisma connects as a privileged role that BYPASSES every policy below.
--  These policies are therefore NOT what stops a Site Engineer on Project A
--  from reading Project B — `project-access.service.ts` is, and that is what
--  the tests exercise.
--
--  What this file protects is the other door: anything reaching the database
--  with the Supabase ANON key, through PostgREST or a browser client, gets
--  nothing back unless the signed-in person is an active member of the
--  project, or holds a company-wide role.
--
--  Defence in depth. Not the gate.
-- ══════════════════════════════════════════════════════════════════════════

-- Company-wide reach, mirroring hasCompanyWideProjectAccess() in src/lib/rbac.ts.
-- The two lists must stay in step; if you add a role there, add it here.
CREATE OR REPLACE FUNCTION app_has_company_wide_access()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u
     WHERE u.id = auth.uid()
       AND u.active
       AND u.system_role IN (
         'company_owner', 'company_admin', 'managing_director',
         'operations_director', 'commercial_director'
       )
  );
$$;

CREATE OR REPLACE FUNCTION app_can_access_project(target_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT app_has_company_wide_access()
      OR EXISTS (
        SELECT 1 FROM project_members pm
         WHERE pm.project_id = target_project_id
           AND pm.user_id = auth.uid()
           AND pm.active
      );
$$;

ALTER TABLE projects                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members             ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_contract_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_documents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE potential_changes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bottlenecks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE potential_change_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_read ON projects;
CREATE POLICY project_read ON projects
  FOR SELECT USING (app_can_access_project(id));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'project_members', 'project_contract_rules', 'contacts', 'project_documents',
    'potential_changes', 'tasks', 'bottlenecks', 'activity_logs',
    'document_chunks', 'potential_change_embeddings'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_read ON %I FOR SELECT USING (app_can_access_project(project_id))',
      t, t
    );
  END LOOP;
END $$;

-- People can see themselves; admins and directors see everyone.
DROP POLICY IF EXISTS users_read ON users;
CREATE POLICY users_read ON users
  FOR SELECT USING (id = auth.uid() OR app_has_company_wide_access());

-- No INSERT / UPDATE / DELETE policies anywhere, deliberately. Writes go
-- through the application, which validates, checks authority and writes the
-- audit event in the same transaction. A direct write would skip all three.

-- Integration events and notification logs carry no project column and are
-- internal machinery; nothing but the service role should ever read them.
ALTER TABLE integration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs  ENABLE ROW LEVEL SECURITY;
