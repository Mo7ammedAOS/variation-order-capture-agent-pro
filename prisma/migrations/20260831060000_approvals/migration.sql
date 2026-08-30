-- Two approval gates, each with two seats.
--
-- The company commits to something outside itself at exactly two points: when
-- the initial notice of variation reaches the client, and when a price is
-- agreed. Both are gated by a project manager AND a managing director. Nothing
-- else is gated, because an approval on every stage is how a process becomes
-- theatre and people start rubber-stamping.

CREATE TYPE "ApprovalGate"     AS ENUM ('notice_issue', 'final_variation');
CREATE TYPE "ApprovalSeat"     AS ENUM ('project_manager', 'managing_director');
CREATE TYPE "ApprovalDecision" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "approvals" (
  "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id"          UUID NOT NULL,
  "potential_change_id" UUID NOT NULL,
  "gate"                "ApprovalGate" NOT NULL,
  "seat"                "ApprovalSeat" NOT NULL,
  "round"               INTEGER NOT NULL DEFAULT 1,
  "decision"            "ApprovalDecision" NOT NULL DEFAULT 'pending',
  "assigned_to_user_id" UUID,
  "decided_by_user_id"  UUID,
  "decided_at"          TIMESTAMP(3),
  "comment"             TEXT,
  "task_id"             UUID,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- One seat per gate per round. This is what stops the same person answering
-- twice, and what makes "resubmit" open a clean round rather than overwrite a
-- rejection that has already been recorded.
CREATE UNIQUE INDEX "approvals_pc_gate_seat_round_key"
  ON "approvals"("potential_change_id", "gate", "seat", "round");
CREATE INDEX "approvals_pc_gate_idx"   ON "approvals"("potential_change_id", "gate");
CREATE INDEX "approvals_assignee_idx"  ON "approvals"("assigned_to_user_id", "decision");

ALTER TABLE "approvals" ADD CONSTRAINT "approvals_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_potential_change_id_fkey"
  FOREIGN KEY ("potential_change_id") REFERENCES "potential_changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: who approved something is history, and it must not
-- disappear because the approver later left the company.
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_assigned_to_user_id_fkey"
  FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_user_id_fkey"
  FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Defence in depth, same as every other project-scoped table. Prisma bypasses
-- this; the service layer is the gate. What this closes is the anon key door.
ALTER TABLE "approvals" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approvals_read ON approvals;
CREATE POLICY approvals_read ON approvals
  FOR SELECT USING (app_can_access_project(project_id));

-- Who may fill each seat. Defaults only: the administrator can change any of
-- this from Settings → Permissions without a deploy.
INSERT INTO "role_permissions" ("scope", "role", "capability", "granted", "updated_at") VALUES
  ('project', 'project_manager',    'approval.projectManager',   true, CURRENT_TIMESTAMP),
  ('system',  'operations_director', 'approval.projectManager',  true, CURRENT_TIMESTAMP),
  ('system',  'managing_director',  'approval.managingDirector', true, CURRENT_TIMESTAMP),
  ('system',  'company_owner',      'approval.managingDirector', true, CURRENT_TIMESTAMP)
ON CONFLICT ("scope", "role", "capability") DO NOTHING;
