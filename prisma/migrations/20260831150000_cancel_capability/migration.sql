-- Cancelling a variation is not a status change. It is the company deciding to
-- stop claiming money it may be entitled to, and it is irreversible in every
-- way that matters commercially — the notice clock keeps running while nobody
-- is working the claim.
--
-- It therefore gets its own capability rather than riding on
-- `potentialChange.changeStatus`, which a quantity surveyor holds so they can
-- move a change ALONG. Pricing a claim and killing one are not the same right.
--
-- Deliberately NOT granted to project_manager or quantity_surveyor by default.
-- Every contractor draws this line differently and the administrator can move
-- it in one click; a default that lets the person under commercial pressure
-- delete the evidence of a claim is the wrong way round to start.

INSERT INTO "role_permissions" ("scope", "role", "capability", "granted", "updated_at") VALUES
  ('project', 'commercial_manager',     'potentialChange.cancel', true, CURRENT_TIMESTAMP),
  ('project', 'contract_administrator', 'potentialChange.cancel', true, CURRENT_TIMESTAMP),
  ('system',  'commercial_manager',     'potentialChange.cancel', true, CURRENT_TIMESTAMP),
  ('system',  'contract_administrator', 'potentialChange.cancel', true, CURRENT_TIMESTAMP),
  ('system',  'commercial_director',    'potentialChange.cancel', true, CURRENT_TIMESTAMP),
  ('system',  'operations_director',    'potentialChange.cancel', true, CURRENT_TIMESTAMP),
  ('system',  'managing_director',      'potentialChange.cancel', true, CURRENT_TIMESTAMP),
  ('system',  'company_admin',          'potentialChange.cancel', true, CURRENT_TIMESTAMP),
  ('system',  'company_owner',          'potentialChange.cancel', true, CURRENT_TIMESTAMP)
ON CONFLICT ("scope", "role", "capability") DO NOTHING;
