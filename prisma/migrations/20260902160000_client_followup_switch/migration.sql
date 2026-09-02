-- Chasing the client becomes a per-project decision rather than a fixed rule.
--
-- `client_follow_up_days` already existed, was editable, was displayed, and was
-- read by no code at all — a dial connected to nothing, which is worse than no
-- dial: somebody sets it, believes the chase changed, and stops watching. It
-- now means what it says: the number of days between one chase and the next.
--
-- The switch is separate rather than encoded as `0 days` because "off" and
-- "every zero days" are different sentences, and a number field that means
-- "never" at one end is how a chase gets turned off by a typo.
ALTER TABLE "project_contract_rules"
  ADD COLUMN IF NOT EXISTS "client_follow_up_enabled" BOOLEAN NOT NULL DEFAULT true;

-- The interval defaulted to 3 days while nothing read it, so no company ever
-- chose 3 — it is the residue of a field that did nothing. Switching the field
-- on at that value would start chasing every client twice a week, which is not
-- what anybody asked for and is the fastest way to be filtered.
--
-- Weekly is the stated intent and the safe end of the range, so every existing
-- row moves to 7 and new rows default to 7. A company that wants tighter can
-- say so on the form; nobody has to undo something they never set.
ALTER TABLE "project_contract_rules"
  ALTER COLUMN "client_follow_up_days" SET DEFAULT 7;

UPDATE "project_contract_rules" SET "client_follow_up_days" = 7
WHERE "client_follow_up_days" = 3;
