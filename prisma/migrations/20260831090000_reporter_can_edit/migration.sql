-- The person who reported a change can correct it.
--
-- Site engineers file from a phone, on site, often one-handed. What they wrote
-- is a first account, not a final one, and the alternative to letting them fix
-- it is a second Potential Change describing the same event — which is worse
-- than a typo, because now there are two records and a duplicate to explain.

INSERT INTO "role_permissions" ("scope", "role", "capability", "granted", "updated_at") VALUES
  -- Editing YOUR OWN report. Every role that can raise one can correct one.
  ('system',  'standard_user',          'potentialChange.updateOwn', true, CURRENT_TIMESTAMP),
  ('project', 'site_engineer',          'potentialChange.updateOwn', true, CURRENT_TIMESTAMP),
  ('project', 'foreman',                'potentialChange.updateOwn', true, CURRENT_TIMESTAMP),
  ('project', 'project_manager',        'potentialChange.updateOwn', true, CURRENT_TIMESTAMP),
  ('project', 'quantity_surveyor',      'potentialChange.updateOwn', true, CURRENT_TIMESTAMP),
  ('project', 'commercial_manager',     'potentialChange.updateOwn', true, CURRENT_TIMESTAMP),
  ('project', 'contract_administrator', 'potentialChange.updateOwn', true, CURRENT_TIMESTAMP),

  -- Reopening: sending a change that has already moved on BACK for rework.
  -- Deliberately narrower than editing. It cancels a live approval round, so
  -- it is not something a reporter does to a change two directors are mid-way
  -- through deciding without it being a considered act.
  ('project', 'site_engineer',          'potentialChange.reopen', true, CURRENT_TIMESTAMP),
  ('project', 'project_manager',        'potentialChange.reopen', true, CURRENT_TIMESTAMP),
  ('project', 'commercial_manager',     'potentialChange.reopen', true, CURRENT_TIMESTAMP),
  ('project', 'contract_administrator', 'potentialChange.reopen', true, CURRENT_TIMESTAMP),
  ('system',  'managing_director',      'potentialChange.reopen', true, CURRENT_TIMESTAMP),
  ('system',  'operations_director',    'potentialChange.reopen', true, CURRENT_TIMESTAMP),
  ('system',  'commercial_director',    'potentialChange.reopen', true, CURRENT_TIMESTAMP),
  ('system',  'company_admin',          'potentialChange.reopen', true, CURRENT_TIMESTAMP),
  ('system',  'company_owner',          'potentialChange.reopen', true, CURRENT_TIMESTAMP)
ON CONFLICT ("scope", "role", "capability") DO NOTHING;

-- ── A hole, closed ────────────────────────────────────────────────────────
--
-- `standard_user` is the DEFAULT system role: every site engineer, project
-- manager and QS in this deployment holds it. Granting `potentialChange.update`
-- at system scope therefore gave everybody the right to edit ANY change on any
-- project they could reach — including one that two directors had already
-- approved — and made the careful project-scope grants for that capability
-- decorative.
--
-- Editing your own report is now `potentialChange.updateOwn`, granted above.
-- Editing somebody else's stays with the project roles that already had it.
DELETE FROM "role_permissions"
 WHERE "scope" = 'system' AND "role" = 'standard_user'
   AND "capability" = 'potentialChange.update';
