-- A real, permanent delete — and who holds it.
--
-- Osman's call, 2026-09-05. Until now the only way to end a change was to
-- cancel it, which is right for a claim the company decided not to pursue and
-- wrong for a record that should never have existed: a test capture, a
-- duplicate filed twice, a message that was not a change at all. Those sit in
-- the register forever wearing a "cancelled" chip, and a register full of them
-- is one nobody trusts at a glance.
--
-- SYSTEM SCOPE ONLY, and deliberately. This is not a permission a project role
-- should be able to hold, because the whole value of the record is that the
-- people working the project cannot make it disappear. It belongs to the two
-- people who answer for the company: the administrator who runs the system and
-- the managing director who runs the business. The owner is included because
-- an owner who cannot do what their own administrator can do reads as a bug,
-- and the operations director because they hold the same company-wide reach
-- over the register.
--
-- Every one of these can be untied in one click on the permissions screen.
INSERT INTO "role_permissions" ("scope", "role", "capability", "granted", "updated_at") VALUES
  ('system', 'company_owner',       'potentialChange.delete', true, CURRENT_TIMESTAMP),
  ('system', 'company_admin',       'potentialChange.delete', true, CURRENT_TIMESTAMP),
  ('system', 'managing_director',   'potentialChange.delete', true, CURRENT_TIMESTAMP),
  ('system', 'operations_director', 'potentialChange.delete', true, CURRENT_TIMESTAMP)
ON CONFLICT ("scope", "role", "capability") DO NOTHING;
