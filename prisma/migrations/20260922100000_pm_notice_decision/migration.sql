-- The PM's notice decision, recorded properly.
--
-- Additive only. No column is dropped and no enum value is removed: changes
-- that already sit in `notice_required` or `pm_scope_review` keep reading, and
-- the approvals those rows carry stay on the record.

ALTER TABLE "potential_changes"
  ADD COLUMN "notice_not_required_reason" TEXT,
  ADD COLUMN "notice_missing_information" TEXT,
  ADD COLUMN "pricing_started_early" BOOLEAN NOT NULL DEFAULT false;
