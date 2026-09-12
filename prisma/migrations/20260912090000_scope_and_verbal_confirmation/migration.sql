-- Two additions that answer two different arguments.
--
-- 1. SCOPE, BEFORE AND AFTER
--
-- A change carried one prose description, so a consultant assessing it had to
-- infer the tendered baseline from context. An inferred baseline is precisely
-- what gets disputed six months later. Two fields make the comparison explicit
-- and put the burden of stating the baseline on us, where it belongs.
--
-- Both nullable on purpose. A change filed from site in thirty seconds has
-- neither; the QS fills them in at pricing, which is the first moment anybody
-- opens the BOQ and can actually say what was tendered.

ALTER TABLE "potential_changes"
  ADD COLUMN "scope_original" TEXT,
  ADD COLUMN "scope_revised"  TEXT;

-- 2. CONFIRMATION OF A VERBAL INSTRUCTION
--
-- Under UAE Civil Code Art. 887 a contractor on a lump-sum muqawala generally
-- cannot recover for extra work without the employer's written agreement to
-- the work and to its price. So a verbally instructed change is worth nothing
-- until somebody puts it in writing, and until now this system captured the
-- word "verbal" and did nothing whatsoever with it.
--
-- The confirmation letter reuses the notice machinery rather than duplicating
-- it, because it needs every part of it: draft, edit, supersede, approve,
-- issue, file to Drive, delivery callback, acknowledgement. Acknowledgement is
-- the point -- the client acknowledging IS the written record Art. 887 asks
-- for.

CREATE TYPE "NoticeKind" AS ENUM ('notice', 'verbal_confirmation');

ALTER TABLE "notices"
  ADD COLUMN "kind" "NoticeKind" NOT NULL DEFAULT 'notice';

-- Versions are per KIND. Without this a change that has both a notice and a
-- confirmation collides at version 1, and the second one to be drafted fails
-- with a constraint error that names a column rather than the reason.
ALTER TABLE "notices"
  DROP CONSTRAINT IF EXISTS "notices_potential_change_id_version_key";

ALTER TABLE "notices"
  ADD CONSTRAINT "notices_potential_change_id_kind_version_key"
  UNIQUE ("potential_change_id", "kind", "version");
