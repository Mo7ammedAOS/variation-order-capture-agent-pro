-- Who sees which doors.
--
-- Osman's call, 2026-09-05. Most of the company should open this app and find
-- four things: Overview, My Tasks, Variations, Held Up. A site engineer needs
-- what is owed by him, what he reported, and what is stuck. Everything else is
-- somebody's job and nobody else's, and a menu full of doors that open onto a
-- polite refusal teaches people that most of the app is not for them — after
-- which they stop reading the part that is.
--
-- Hiding a link is NOT the enforcement. Every gated page already refuses on
-- the server: the permissions and users screens throw from their service, the
-- company screen checks before it lets anything be edited, and the capture
-- inbox now asks for the capability below rather than for
-- `potentialChange.create`, which every site engineer holds and which had left
-- that queue open to the whole company since it was built.

-- ── The capture inbox ─────────────────────────────────────────────────────
--
-- A new capability rather than reusing an existing one, because it is a
-- genuinely different right. The inbox holds messages the system could not
-- place: other people's half-understood reports, from every project, waiting
-- for somebody to work out what they were. Reading it is reading everybody's
-- post.
--
-- Administrator and owner only. NOT the managing director, by his own
-- instruction — working a triage queue is administration rather than
-- direction, and a director who wants it can be given it in one click.
INSERT INTO "role_permissions" ("scope", "role", "capability", "granted", "updated_at") VALUES
  ('system', 'company_owner', 'capture.triage', true, CURRENT_TIMESTAMP),
  ('system', 'company_admin', 'capture.triage', true, CURRENT_TIMESTAMP)
ON CONFLICT ("scope", "role", "capability") DO UPDATE SET "granted" = true, "updated_at" = CURRENT_TIMESTAMP;

-- ── The director sees every door the administrator does ───────────────────
--
-- The managing director held neither `user.manage` nor
-- `companySettings.manage`, so the Users, Permissions and Company screens were
-- closed to him — he had to ask somebody junior to add a person to a project.
-- Osman's instruction is that these belong to the two people who answer for
-- the company. The operations director holds the same company-wide reach over
-- the register and is included for the same reason.
INSERT INTO "role_permissions" ("scope", "role", "capability", "granted", "updated_at") VALUES
  ('system', 'managing_director',   'user.manage',            true, CURRENT_TIMESTAMP),
  ('system', 'managing_director',   'companySettings.manage', true, CURRENT_TIMESTAMP),
  ('system', 'operations_director', 'user.manage',            true, CURRENT_TIMESTAMP),
  ('system', 'operations_director', 'companySettings.manage', true, CURRENT_TIMESTAMP)
ON CONFLICT ("scope", "role", "capability") DO UPDATE SET "granted" = true, "updated_at" = CURRENT_TIMESTAMP;
