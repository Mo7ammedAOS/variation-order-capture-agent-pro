-- Two holes in the money loop, and the basis for a time claim.
--
-- 1. A credit note. Until now an over-certification, or a payment against the
--    wrong invoice, was REFUSED rather than corrected — so a wrong figure that
--    reached the client could never be put right.
-- 2. Retention release. Retention was withheld correctly and reported as held,
--    and nothing ever gave it back.
-- 3. `time_impact_basis` — a number of days with no stated critical-path
--    reason is refused by every engineer who assesses one.

CREATE TYPE "InvoiceKind" AS ENUM ('application', 'retention_release');
CREATE TYPE "RetentionStage" AS ENUM ('practical_completion', 'defects_liability_end');
CREATE TYPE "CreditNoteReason" AS ENUM ('over_certification', 'wrong_invoice', 'client_deduction', 'duplicate', 'other');
CREATE TYPE "CreditNoteStatus" AS ENUM ('draft', 'issued', 'cancelled');

-- Every row that exists today is an application, because that is all there was.
ALTER TABLE "invoices"
  ADD COLUMN "kind" "InvoiceKind" NOT NULL DEFAULT 'application',
  ADD COLUMN "retention_released" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "retention_stage" "RetentionStage";

ALTER TABLE "projects"
  ADD COLUMN "credit_note_sequence" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "project_contract_rules"
  ADD COLUMN "retention_release_percent_at_pc" DECIMAL(6,3) NOT NULL DEFAULT 50,
  ADD COLUMN "defects_liability_days" INTEGER NOT NULL DEFAULT 365;

ALTER TABLE "variation_orders"
  ADD COLUMN "time_impact_basis" TEXT;

CREATE TABLE "credit_notes" (
  "id"                 UUID NOT NULL,
  "project_id"         UUID NOT NULL,
  "invoice_id"         UUID NOT NULL,
  "credit_note_number" TEXT NOT NULL,
  "status"             "CreditNoteStatus" NOT NULL DEFAULT 'draft',
  "reason"             "CreditNoteReason" NOT NULL,
  "narrative"          TEXT NOT NULL,
  "gross_amount"       DECIMAL(18,2) NOT NULL,
  "retention_amount"   DECIMAL(18,2) NOT NULL,
  "net_value"          DECIMAL(18,2) NOT NULL,
  "vat_percent"        DECIMAL(6,3) NOT NULL,
  "vat_amount"         DECIMAL(18,2) NOT NULL,
  "total_credited"     DECIMAL(18,2) NOT NULL,
  "issued_at"          TIMESTAMP(3),
  "issued_by_user_id"  UUID,
  "cancelled_at"       TIMESTAMP(3),
  "cancelled_reason"   TEXT,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credit_notes_project_id_credit_note_number_key"
  ON "credit_notes"("project_id", "credit_note_number");
CREATE INDEX "credit_notes_project_id_status_idx" ON "credit_notes"("project_id", "status");
CREATE INDEX "credit_notes_invoice_id_idx" ON "credit_notes"("invoice_id");

ALTER TABLE "credit_notes"
  ADD CONSTRAINT "credit_notes_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "credit_notes_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "credit_notes_issued_by_user_id_fkey"
    FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reads are scoped the same way every other commercial table is. No write
-- policy, deliberately: writes go through the app or they do not happen.
ALTER TABLE "credit_notes" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_notes_read ON credit_notes;
CREATE POLICY credit_notes_read ON credit_notes
  FOR SELECT USING (app_can_access_project(project_id));
