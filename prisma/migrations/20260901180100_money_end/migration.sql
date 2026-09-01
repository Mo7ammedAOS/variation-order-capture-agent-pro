-- The money end: variation orders, progress applications, payments.
--
-- Until now the lifecycle stopped at `variation_approved`. The company could
-- see that a change had been agreed internally and had no way at all to say
-- whether it had been put to the client, agreed by them, invoiced, or paid.
-- The gap between "agreed" and "paid" is the number that justifies this
-- product, and it could not be produced.
--
-- Three decisions of Osman's are baked into these tables, 2026-09-01:
--
--   1. ONE VO PER CHANGE. The unique index on potential_change_id is the rule,
--      not a convention. A rejected VO drags nothing else down, and a partial
--      approval never has to be apportioned back across bundled changes.
--
--   2. PROGRESS APPLICATIONS, MONTHLY, WITH RETENTION. Not one invoice per VO.
--      Each `invoices` row is an application for a percentage of the agreed
--      value, less what was applied for before, less retention, plus VAT.
--
--   3. A PARTIAL APPROVAL LEAVES A VISIBLE SHORTFALL. `submitted_value` and
--      `approved_value` are separate columns and the lower figure never
--      overwrites the higher. A company that cannot say what it conceded
--      cannot learn to concede less.
--
-- Every money column is NUMERIC, never a float, and every derived figure
-- (overdue, approved-but-unbilled, retention held) is computed on read from
-- rows that cannot go stale.

CREATE TYPE "VariationOrderStatus" AS ENUM
  ('draft', 'submitted', 'approved', 'part_approved', 'rejected', 'withdrawn');
CREATE TYPE "ClientResponse" AS ENUM
  ('awaiting', 'approved', 'approved_with_adjustment', 'rejected', 'more_information_requested');
CREATE TYPE "InvoiceStatus" AS ENUM
  ('draft', 'issued', 'part_paid', 'paid', 'cancelled');

-- Separate series, per project. A VO number is quoted on a payment certificate
-- and an invoice number on a bank transfer, so neither may move because
-- something upstream was renumbered. Per project rather than company-wide,
-- because a company-wide invoice series tells every client how much work the
-- contractor has on, from the size of the gaps.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "vo_sequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "invoice_sequence" INTEGER NOT NULL DEFAULT 0;

-- 5% and 10% retention are both ordinary in UAE fit-out, so it is per project
-- and never a global default.
ALTER TABLE "project_contract_rules"
  ADD COLUMN IF NOT EXISTS "retention_percent" DECIMAL(6,3) NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "vo_response_days" INTEGER NOT NULL DEFAULT 14;

-- UAE VAT, 5% since 2018. A setting rather than a constant, because a rate
-- change must not require a deploy and a zero-rated deployment is a real case.
ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "vat_percent" DECIMAL(6,3) NOT NULL DEFAULT 5;

CREATE TABLE "variation_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "potential_change_id" UUID NOT NULL,
  "vo_number" TEXT NOT NULL,
  "status" "VariationOrderStatus" NOT NULL DEFAULT 'draft',
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "submitted_value" DECIMAL(18,2),
  "submitted_at" TIMESTAMP(3),
  "submitted_by_user_id" UUID,
  "time_impact_days_claimed" INTEGER,
  "client_response" "ClientResponse" NOT NULL DEFAULT 'awaiting',
  "client_response_at" TIMESTAMP(3),
  "approved_value" DECIMAL(18,2),
  "approved_time_impact_days" INTEGER,
  "client_reference" TEXT,
  "client_response_notes" TEXT,
  "recorded_by_user_id" UUID,
  "document_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "variation_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "variation_orders_potential_change_id_key"
  ON "variation_orders"("potential_change_id");
CREATE UNIQUE INDEX "variation_orders_project_id_vo_number_key"
  ON "variation_orders"("project_id", "vo_number");
CREATE UNIQUE INDEX "variation_orders_document_id_key" ON "variation_orders"("document_id");
CREATE INDEX "variation_orders_project_id_status_idx"
  ON "variation_orders"("project_id", "status");
CREATE INDEX "variation_orders_client_response_submitted_at_idx"
  ON "variation_orders"("client_response", "submitted_at");

ALTER TABLE "variation_orders" ADD CONSTRAINT "variation_orders_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "variation_orders" ADD CONSTRAINT "variation_orders_potential_change_id_fkey"
  FOREIGN KEY ("potential_change_id") REFERENCES "potential_changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "variation_orders" ADD CONSTRAINT "variation_orders_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "project_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "variation_orders" ADD CONSTRAINT "variation_orders_submitted_by_user_id_fkey"
  FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "variation_orders" ADD CONSTRAINT "variation_orders_recorded_by_user_id_fkey"
  FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "invoices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "variation_order_id" UUID NOT NULL,
  "invoice_number" TEXT NOT NULL,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
  "period_end" DATE NOT NULL,
  "cumulative_percent" DECIMAL(6,3) NOT NULL,
  "basis_value" DECIMAL(18,2) NOT NULL,
  "previously_applied" DECIMAL(18,2) NOT NULL,
  "gross_this_period" DECIMAL(18,2) NOT NULL,
  "retention_percent" DECIMAL(6,3) NOT NULL,
  "retention_amount" DECIMAL(18,2) NOT NULL,
  "net_value" DECIMAL(18,2) NOT NULL,
  "vat_percent" DECIMAL(6,3) NOT NULL,
  "vat_amount" DECIMAL(18,2) NOT NULL,
  "total_due" DECIMAL(18,2) NOT NULL,
  "issued_at" TIMESTAMP(3),
  "issued_by_user_id" UUID,
  "due_at" DATE,
  "client_reference" TEXT,
  "notes" TEXT,
  "cancelled_at" TIMESTAMP(3),
  "cancelled_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoices_project_id_invoice_number_key"
  ON "invoices"("project_id", "invoice_number");
CREATE INDEX "invoices_project_id_status_idx" ON "invoices"("project_id", "status");
CREATE INDEX "invoices_variation_order_id_period_end_idx"
  ON "invoices"("variation_order_id", "period_end");
CREATE INDEX "invoices_status_due_at_idx" ON "invoices"("status", "due_at");

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_variation_order_id_fkey"
  FOREIGN KEY ("variation_order_id") REFERENCES "variation_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_user_id_fkey"
  FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "received_at" DATE NOT NULL,
  "reference" TEXT,
  "method" TEXT,
  "notes" TEXT,
  "recorded_by_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payments_project_id_received_at_idx" ON "payments"("project_id", "received_at");
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");

ALTER TABLE "payments" ADD CONSTRAINT "payments_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_fkey"
  FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Defence in depth, as every other project-scoped table. Prisma bypasses this;
-- the service layer is the gate. What this closes is the anon key door — and
-- these three tables are the ones where that door opening would be worst,
-- because they hold what the company is owed and by whom.
ALTER TABLE "variation_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS variation_orders_read ON variation_orders;
CREATE POLICY variation_orders_read ON variation_orders
  FOR SELECT USING (app_can_access_project(project_id));
DROP POLICY IF EXISTS invoices_read ON invoices;
CREATE POLICY invoices_read ON invoices
  FOR SELECT USING (app_can_access_project(project_id));
DROP POLICY IF EXISTS payments_read ON payments;
CREATE POLICY payments_read ON payments
  FOR SELECT USING (app_can_access_project(project_id));

-- Who may put a variation to a client, apply for money, and record a receipt.
--
-- Inserted here rather than left to the seed, which only fills an EMPTY
-- permissions table: a live deployment would otherwise gain three capabilities
-- in code with no rows behind them, and a missing row is a DENIAL.
--
-- Finance holds the invoicing and the receipts and NOTHING else. That
-- separation is the point of them being distinct capabilities: the person who
-- agrees a figure with a client should not also be the person who says the
-- money arrived.
INSERT INTO "role_permissions" ("scope", "role", "capability", "granted", "updated_at") VALUES
  ('system',  'company_owner',          'variationOrder.manage', true, CURRENT_TIMESTAMP),
  ('system',  'company_admin',          'variationOrder.manage', true, CURRENT_TIMESTAMP),
  ('system',  'managing_director',      'variationOrder.manage', true, CURRENT_TIMESTAMP),
  ('system',  'commercial_director',    'variationOrder.manage', true, CURRENT_TIMESTAMP),
  ('system',  'commercial_manager',     'variationOrder.manage', true, CURRENT_TIMESTAMP),
  ('system',  'contract_administrator', 'variationOrder.manage', true, CURRENT_TIMESTAMP),
  ('project', 'project_manager',        'variationOrder.manage', true, CURRENT_TIMESTAMP),
  ('project', 'quantity_surveyor',      'variationOrder.manage', true, CURRENT_TIMESTAMP),
  ('project', 'commercial_manager',     'variationOrder.manage', true, CURRENT_TIMESTAMP),
  ('project', 'contract_administrator', 'variationOrder.manage', true, CURRENT_TIMESTAMP),

  ('system',  'company_owner',          'invoice.manage', true, CURRENT_TIMESTAMP),
  ('system',  'company_admin',          'invoice.manage', true, CURRENT_TIMESTAMP),
  ('system',  'managing_director',      'invoice.manage', true, CURRENT_TIMESTAMP),
  ('system',  'commercial_director',    'invoice.manage', true, CURRENT_TIMESTAMP),
  ('system',  'commercial_manager',     'invoice.manage', true, CURRENT_TIMESTAMP),
  ('system',  'contract_administrator', 'invoice.manage', true, CURRENT_TIMESTAMP),
  ('system',  'finance_manager',        'invoice.manage', true, CURRENT_TIMESTAMP),
  ('project', 'commercial_manager',     'invoice.manage', true, CURRENT_TIMESTAMP),
  ('project', 'contract_administrator', 'invoice.manage', true, CURRENT_TIMESTAMP),
  ('project', 'finance_officer',        'invoice.manage', true, CURRENT_TIMESTAMP),

  ('system',  'company_owner',       'payment.record', true, CURRENT_TIMESTAMP),
  ('system',  'company_admin',       'payment.record', true, CURRENT_TIMESTAMP),
  ('system',  'managing_director',   'payment.record', true, CURRENT_TIMESTAMP),
  ('system',  'commercial_director', 'payment.record', true, CURRENT_TIMESTAMP),
  ('system',  'commercial_manager',  'payment.record', true, CURRENT_TIMESTAMP),
  ('system',  'finance_manager',     'payment.record', true, CURRENT_TIMESTAMP),
  ('project', 'finance_officer',     'payment.record', true, CURRENT_TIMESTAMP)
ON CONFLICT ("scope", "role", "capability") DO NOTHING;
