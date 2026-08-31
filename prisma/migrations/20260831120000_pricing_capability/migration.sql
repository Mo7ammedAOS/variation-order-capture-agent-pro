-- Who may price a change.
--
-- Needed because pricing is now a STAGE the app hands to somebody, and every
-- stage resolves its owner by capability rather than by job title. Without this
-- the QS pricing stage had nobody to give the work to, so a change arrived
-- there owned by no one and appeared on no list — which is exactly what
-- happened to PC-AUH-003-0006 after both approvals went in.

INSERT INTO "role_permissions" ("scope", "role", "capability", "granted", "updated_at") VALUES
  ('project', 'quantity_surveyor',      'pricing.submit', true, CURRENT_TIMESTAMP),
  ('project', 'commercial_manager',     'pricing.submit', true, CURRENT_TIMESTAMP),
  ('project', 'contract_administrator', 'pricing.submit', true, CURRENT_TIMESTAMP),
  ('system',  'commercial_director',    'pricing.submit', true, CURRENT_TIMESTAMP),
  ('system',  'commercial_manager',     'pricing.submit', true, CURRENT_TIMESTAMP),
  ('system',  'company_admin',          'pricing.submit', true, CURRENT_TIMESTAMP),
  ('system',  'company_owner',          'pricing.submit', true, CURRENT_TIMESTAMP)
ON CONFLICT ("scope", "role", "capability") DO NOTHING;
