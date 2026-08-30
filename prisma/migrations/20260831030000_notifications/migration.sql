-- Notifications: telling the person a decision is waiting on them, and going
-- on telling them until it is made.
--
-- The table already existed as a delivery log with nothing writing to it. What
-- it lacked was everything needed to CHASE: who the message is for, which task
-- it is about, why it was sent, and a key that makes running the daily sweep
-- twice harmless.

CREATE TYPE "NotificationKind" AS ENUM ('task_assigned', 'task_reminder', 'task_escalation');

ALTER TABLE "notification_logs"
  ADD COLUMN "task_id"          UUID,
  ADD COLUMN "user_id"          UUID,
  ADD COLUMN "kind"             "NotificationKind" NOT NULL DEFAULT 'task_assigned',
  ADD COLUMN "body"             TEXT,
  ADD COLUMN "escalation_level" "EscalationLevel"  NOT NULL DEFAULT 'none',
  ADD COLUMN "read_at"          TIMESTAMP(3),
  ADD COLUMN "last_attempt_at"  TIMESTAMP(3),
  ADD COLUMN "dedupe_key"       TEXT;

-- Any pre-existing row keeps a key of its own id: unique by construction, and
-- it can never collide with a generated one, which always carries a colon.
UPDATE "notification_logs" SET "dedupe_key" = "id"::text WHERE "dedupe_key" IS NULL;

ALTER TABLE "notification_logs" ALTER COLUMN "dedupe_key" SET NOT NULL;

-- The unique index IS the idempotency mechanism, not a tidiness measure. The
-- sweep inserts with ON CONFLICT DO NOTHING and relies on the database to
-- decide what is a repeat, because that decision has to survive a restart.
CREATE UNIQUE INDEX "notification_logs_dedupe_key_key" ON "notification_logs"("dedupe_key");
CREATE INDEX "notification_logs_user_id_read_at_idx" ON "notification_logs"("user_id", "read_at");
CREATE INDEX "notification_logs_task_id_idx" ON "notification_logs"("task_id");

ALTER TABLE "notification_logs"
  ADD CONSTRAINT "notification_logs_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cascade rather than SET NULL: an in-app notification is addressed to one
-- person and means nothing without them. The audit trail of what HAPPENED
-- lives in activity_logs, which does keep its rows when a user is removed.
ALTER TABLE "notification_logs"
  ADD CONSTRAINT "notification_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
