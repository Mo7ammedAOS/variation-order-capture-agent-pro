-- The QS build-up.
--
-- Until now a priced change was one mutable number in a box, with nothing
-- showing how it was arrived at and nothing stopping it changing after two
-- directors approved it. Both of those are the difference between a claim that
-- survives a challenge and one that does not.

CREATE TYPE "RateSource"    AS ENUM ('contract_boq', 'pro_rata', 'star_rate', 'quotation', 'daywork');
CREATE TYPE "CostCategory"  AS ENUM ('labour', 'material', 'plant', 'subcontractor', 'other');
CREATE TYPE "PricingStatus" AS ENUM ('not_started', 'draft', 'submitted', 'approved');

ALTER TABLE "potential_changes"
  ADD COLUMN "pricing_status"          "PricingStatus" NOT NULL DEFAULT 'not_started',
  ADD COLUMN "prelims_percent"         DECIMAL(6,3),
  ADD COLUMN "overhead_profit_percent" DECIMAL(6,3),
  -- Frozen at submission. Never recomputed, because the figure two directors
  -- approve must be the figure that was put in front of them.
  ADD COLUMN "submitted_value"         DECIMAL(14,2),
  ADD COLUMN "submitted_at"            TIMESTAMP(3),
  ADD COLUMN "submitted_by_user_id"    UUID,
  ADD COLUMN "pricing_notes"           TEXT;

ALTER TABLE "potential_changes"
  ADD CONSTRAINT "potential_changes_submitted_by_user_id_fkey"
  FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "pricing_line_items" (
  "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
  "potential_change_id" UUID NOT NULL,
  "project_id"          UUID NOT NULL,
  "sequence"            INTEGER NOT NULL,
  "description"         TEXT NOT NULL,
  "quantity"            DECIMAL(14,3) NOT NULL,
  "unit"                TEXT NOT NULL DEFAULT 'no',
  "rate"                DECIMAL(14,2) NOT NULL,
  -- Stored, and computed on the server from quantity x rate. A total that is
  -- right on screen and different in the database is found in a payment
  -- dispute, which is the worst possible place to find it.
  "amount"              DECIMAL(14,2) NOT NULL,
  "rate_source"         "RateSource"   NOT NULL DEFAULT 'star_rate',
  "category"            "CostCategory" NOT NULL DEFAULT 'other',
  "boq_reference"       TEXT,
  "notes"               TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pricing_line_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pricing_line_items_pc_sequence_idx"
  ON "pricing_line_items"("potential_change_id", "sequence");

ALTER TABLE "pricing_line_items" ADD CONSTRAINT "pricing_line_items_pc_fkey"
  FOREIGN KEY ("potential_change_id") REFERENCES "potential_changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pricing_line_items" ADD CONSTRAINT "pricing_line_items_project_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Defence in depth, same as every other project-scoped table.
ALTER TABLE "pricing_line_items" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pricing_line_items_read ON pricing_line_items;
CREATE POLICY pricing_line_items_read ON pricing_line_items
  FOR SELECT USING (app_can_access_project(project_id));
