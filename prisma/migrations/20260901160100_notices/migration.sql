-- The notice itself: draft, approved, issued, served, acknowledged.
--
-- Until now the system decided a notice was REQUIRED and then stopped. There
-- was no document, nothing was ever sent, and `notice_status` stayed at
-- 'required' for the life of the change. The three bottleneck types that have
-- existed since the first migration — notice_required_not_drafted,
-- notice_drafted_not_sent, notice_sent_no_proof — described a lifecycle no
-- table could hold.
--
-- A separate table rather than columns on potential_changes, because a
-- rejected notice is redrafted and the rejected round has to survive intact.
-- Columns would be overwritten by the redraft, and the file would lose its own
-- history at the exact moment somebody is arguing about it.

CREATE TYPE "NoticeIssueStatus" AS ENUM ('draft', 'issued', 'sent', 'acknowledged', 'superseded');

-- Its own counter. A notice reference is quoted in correspondence, so it must
-- not move when a change is renumbered, and it must not imply that PC-0042
-- produced notice 0042 when most changes never produce one at all.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "notice_sequence" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "notices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "potential_change_id" UUID NOT NULL,
  "reference" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "NoticeIssueStatus" NOT NULL DEFAULT 'draft',
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "recipient_name" TEXT,
  "recipient_company" TEXT,
  "recipient_email" TEXT,
  "clause_reference" TEXT,
  "drafted_by_user_id" UUID,
  "drafted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issued_by_user_id" UUID,
  "issued_at" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "external_message_id" TEXT,
  "acknowledged_at" TIMESTAMP(3),
  "acknowledged_by_user_id" UUID,
  "acknowledgement_reference" TEXT,
  "document_id" UUID,
  "notification_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notices_potential_change_id_version_key"
  ON "notices"("potential_change_id", "version");
CREATE UNIQUE INDEX "notices_project_id_reference_key" ON "notices"("project_id", "reference");
CREATE UNIQUE INDEX "notices_document_id_key" ON "notices"("document_id");
CREATE UNIQUE INDEX "notices_notification_id_key" ON "notices"("notification_id");
CREATE INDEX "notices_project_id_status_idx" ON "notices"("project_id", "status");

ALTER TABLE "notices" ADD CONSTRAINT "notices_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notices" ADD CONSTRAINT "notices_potential_change_id_fkey"
  FOREIGN KEY ("potential_change_id") REFERENCES "potential_changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notices" ADD CONSTRAINT "notices_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "project_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notices" ADD CONSTRAINT "notices_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "notification_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notices" ADD CONSTRAINT "notices_drafted_by_user_id_fkey"
  FOREIGN KEY ("drafted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notices" ADD CONSTRAINT "notices_issued_by_user_id_fkey"
  FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notices" ADD CONSTRAINT "notices_acknowledged_by_user_id_fkey"
  FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Defence in depth, exactly as every other project-scoped table. Prisma
-- connects with a role that bypasses this; the service layer is the real gate.
-- This closes the door for anything arriving through the anon key or PostgREST.
ALTER TABLE "notices" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notices_read ON notices;
CREATE POLICY notices_read ON notices
  FOR SELECT USING (app_can_access_project(project_id));

-- Who may write the notice, and who may record that the client acknowledged it.
--
-- Inserted here rather than left to the seed: the seed only installs a baseline
-- into an EMPTY permissions table, so a live deployment would have gained the
-- two capabilities in code with no rows behind them — and a missing row is a
-- DENIAL. Everybody would have found the button refused. Defaults only; the
-- administrator can change any of it from Settings, Permissions.
INSERT INTO "role_permissions" ("scope", "role", "capability", "granted", "updated_at") VALUES
  ('system',  'company_owner',           'notice.draft',       true, CURRENT_TIMESTAMP),
  ('system',  'company_admin',           'notice.draft',       true, CURRENT_TIMESTAMP),
  ('system',  'managing_director',       'notice.draft',       true, CURRENT_TIMESTAMP),
  ('system',  'commercial_director',     'notice.draft',       true, CURRENT_TIMESTAMP),
  ('system',  'commercial_manager',      'notice.draft',       true, CURRENT_TIMESTAMP),
  ('system',  'contract_administrator',  'notice.draft',       true, CURRENT_TIMESTAMP),
  ('project', 'project_manager',         'notice.draft',       true, CURRENT_TIMESTAMP),
  ('project', 'commercial_manager',      'notice.draft',       true, CURRENT_TIMESTAMP),
  ('project', 'contract_administrator',  'notice.draft',       true, CURRENT_TIMESTAMP),
  ('system',  'company_owner',           'notice.acknowledge', true, CURRENT_TIMESTAMP),
  ('system',  'company_admin',           'notice.acknowledge', true, CURRENT_TIMESTAMP),
  ('system',  'managing_director',       'notice.acknowledge', true, CURRENT_TIMESTAMP),
  ('system',  'commercial_director',     'notice.acknowledge', true, CURRENT_TIMESTAMP),
  ('system',  'commercial_manager',      'notice.acknowledge', true, CURRENT_TIMESTAMP),
  ('system',  'contract_administrator',  'notice.acknowledge', true, CURRENT_TIMESTAMP),
  ('project', 'project_manager',         'notice.acknowledge', true, CURRENT_TIMESTAMP),
  ('project', 'commercial_manager',      'notice.acknowledge', true, CURRENT_TIMESTAMP),
  ('project', 'contract_administrator',  'notice.acknowledge', true, CURRENT_TIMESTAMP)
ON CONFLICT ("scope", "role", "capability") DO NOTHING;
