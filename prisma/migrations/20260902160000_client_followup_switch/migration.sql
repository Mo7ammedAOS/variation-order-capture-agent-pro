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
