-- "Who should be updated here", separate from who may see it.
--
-- Access and notification are different questions. A director may need telling
-- about a change on a project they never open; a site engineer needs full
-- access and does not need a message every time a colleague files something.
-- Conflating them gives you either a silent system or one everybody mutes.
ALTER TABLE "project_members"
  ADD COLUMN "notify_on_change" BOOLEAN NOT NULL DEFAULT false;

-- Project managers are the sensible default: they are accountable for the
-- change register on their own project. Everyone else opts in.
UPDATE "project_members"
   SET "notify_on_change" = true
 WHERE "project_role" = 'project_manager' AND "active" = true;

CREATE INDEX "project_members_notify_idx"
    ON "project_members" ("project_id", "notify_on_change")
 WHERE "notify_on_change" = true;
