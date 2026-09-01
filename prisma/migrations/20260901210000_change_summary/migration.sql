-- The model's standardised restatement of a captured report.
--
-- Kept apart from `description`, which stays the reporter's own words because
-- it is printed verbatim in a contractual notice. This column is convenience
-- and may be wrong; that one is evidence and may not.

ALTER TABLE "potential_changes" ADD COLUMN "summary" TEXT;
