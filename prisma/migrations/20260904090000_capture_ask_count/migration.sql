-- How many times this question has been put to the reporter.
--
-- The exchange re-asks when a reply answers some of what was asked and not the
-- rest. Without a count that has no floor: a man who answers two of three
-- questions every time gets the third one back for ever, and the fastest way
-- to make somebody stop reading a system is to ask him the same thing twice.
ALTER TABLE "capture_questions"
  ADD COLUMN IF NOT EXISTS "ask_count" INTEGER NOT NULL DEFAULT 1;
