-- The project manager can actually assess a notice now.
--
-- ── The bug, reported from live on 2026-09-05 ─────────────────────────────
-- Two changes were captured on two different projects and neither project
-- manager received the "decide whether a notice is required" task. Not a
-- routing bug and not a notification bug: the work was never assigned to
-- anybody at all.
--
-- Routing asks the same question the button asks — it looks for the members of
-- the project who HOLD `potentialChange.assessNotice`, which is the rule that
-- stops work being handed to someone who would then find no button on the
-- page. `NOTICE_ASSESSMENT_PREFERENCE` in src/lib/rbac.ts even lists
-- `project_manager` as a fallback. But the permission matrix granted that
-- capability, at project scope, only to `commercial_manager` and
-- `contract_administrator`. So on a project staffed the normal way — a project
-- manager, a QS, a couple of site engineers — the holder list came back EMPTY.
--
-- `pickResponsibleMember` correctly returned null, the change was created
-- deliberately unowned so it would surface as a bottleneck rather than sit on
-- somebody powerless, and the task was created with no assignee. Which is why
-- it appeared in nobody's My Tasks and the notice clock ran on unattended.
--
-- The preference list was dead code: it named a role that could never match.
--
-- Every document this product has describes the project manager as the person
-- who decides whether a change needs a formal notice. The matrix was the one
-- place that disagreed.
INSERT INTO "role_permissions" ("scope", "role", "capability", "granted", "updated_at") VALUES
  ('project', 'project_manager', 'potentialChange.assessNotice', true, CURRENT_TIMESTAMP)
ON CONFLICT ("scope", "role", "capability") DO UPDATE SET "granted" = true, "updated_at" = CURRENT_TIMESTAMP;

-- ── And the administrator stops touching notices ──────────────────────────
--
-- Osman's call, 2026-09-04: an administrator sets the system up, and a notice
-- is not set-up. It is served in the company's name, it is the document
-- produced when entitlement is argued, and the person who signs it has to be
-- the person who assessed it. That decision was applied to the DEFAULTS in
-- src/lib/rbac.ts, which are seed data only — the live matrix is read from
-- this table, so nothing changed on the running system and an administrator
-- has been able to draft and serve notices ever since.
DELETE FROM "role_permissions"
WHERE "scope" = 'system'
  AND "role" = 'company_admin'
  AND "capability" IN (
    'notice.draft',
    'notice.acknowledge',
    'potentialChange.assessNotice'
  );

-- ── The two changes already sitting unowned ───────────────────────────────
--
-- Granting the right does not retro-assign work that was created without an
-- owner. These two updates do, for every change still waiting on an assessment
-- with nobody on it — not only the two reported, because if it happened twice
-- it happened every time a project had no commercial manager on it.
--
-- The active project manager, and nothing else: no fallback to "any member",
-- because assigning a notice decision to whoever happens to be on the project
-- is the failure this whole capability model exists to prevent. A project with
-- no project manager stays unowned and stays visible as a bottleneck, which is
-- the correct outcome and a question for a human.
UPDATE "potential_changes" pc
SET "current_owner_user_id" = m."user_id",
    "updated_at" = CURRENT_TIMESTAMP
FROM "project_members" m
WHERE pc."current_owner_user_id" IS NULL
  AND pc."current_status" = 'notice_assessment'
  AND m."project_id" = pc."project_id"
  AND m."project_role" = 'project_manager'
  AND m."active" = true;

UPDATE "tasks" t
SET "assigned_to_user_id" = pc."current_owner_user_id",
    "updated_at" = CURRENT_TIMESTAMP
FROM "potential_changes" pc
WHERE t."potential_change_id" = pc."id"
  AND t."assigned_to_user_id" IS NULL
  AND t."task_type" = 'notice_assessment'
  AND t."status" IN ('open', 'in_progress', 'blocked')
  AND pc."current_owner_user_id" IS NOT NULL;
