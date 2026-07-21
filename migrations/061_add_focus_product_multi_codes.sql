BEGIN;

-- Some focus targets cover several product codes that share ONE target: the
-- staff may sell any mix of them, as long as the combined quantity clears the
-- number. Real example from the source Excel — Vicks Vapodrop is targeted at
-- 50 for branch 003 across IC-004754 (honey-lemon) and IC-004755 (orange);
-- 25/25 or 50/0 both count as met.
--
-- Until now the schema was one product per row, so seeding kept only the first
-- code and recorded the paired code as free text in `note`. That silently
-- undercounts: in July 2026, branches 001 and 003 both cleared the Vicks
-- target on combined sales (61 and 73 against 50) but were reported as having
-- missed it, because only the honey-lemon code was counted.
--
-- `product_code` is retained as the primary/display code (it backs an existing
-- index and every current query) and is constrained to stay in step with the
-- first element of the new array, so there is exactly one source of truth for
-- "which code leads this row".

ALTER TABLE focus.focus_products
  ADD COLUMN IF NOT EXISTS product_codes text[];

UPDATE focus.focus_products
SET product_codes = ARRAY[product_code]
WHERE product_codes IS NULL;

ALTER TABLE focus.focus_products
  ALTER COLUMN product_codes SET NOT NULL;

ALTER TABLE focus.focus_products
  DROP CONSTRAINT IF EXISTS focus_products_product_codes_nonempty;
ALTER TABLE focus.focus_products
  ADD CONSTRAINT focus_products_product_codes_nonempty
  CHECK (array_length(product_codes, 1) >= 1);

-- Deliberately a trigger rather than a CHECK (product_code = product_codes[1]).
-- This migration has to be safe to apply while the CURRENT backend is still
-- running: that code writes `product_code` only. A CHECK would make every such
-- write fail until the new build is deployed, and leaving the columns
-- unsynchronised would be worse than an error — the row would keep counting the
-- PREVIOUS product's sales. The trigger keeps old and new writers correct, so
-- the migration and the deploy can happen in either order.
CREATE OR REPLACE FUNCTION focus.sync_focus_product_codes()
RETURNS trigger AS $$
BEGIN
  IF NEW.product_codes IS NULL OR array_length(NEW.product_codes, 1) IS NULL THEN
    NEW.product_codes := ARRAY[NEW.product_code];
  ELSIF TG_OP = 'UPDATE'
        AND NEW.product_code IS DISTINCT FROM OLD.product_code
        AND NEW.product_codes IS NOT DISTINCT FROM OLD.product_codes THEN
    -- Legacy writer repointed the row at another product without touching the
    -- array: rebuild it with the new lead, preserving any grouped extras.
    NEW.product_codes := ARRAY[NEW.product_code] || COALESCE(
      (SELECT array_agg(code ORDER BY ord)
       FROM unnest(OLD.product_codes) WITH ORDINALITY AS t(code, ord)
       WHERE code <> OLD.product_code AND code <> NEW.product_code),
      ARRAY[]::text[]
    );
  ELSIF NEW.product_codes[1] IS DISTINCT FROM NEW.product_code THEN
    NEW.product_code := NEW.product_codes[1];
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_focus_product_codes ON focus.focus_products;
CREATE TRIGGER trg_sync_focus_product_codes
  BEFORE INSERT OR UPDATE ON focus.focus_products
  FOR EACH ROW EXECUTE FUNCTION focus.sync_focus_product_codes();

-- Progress lookups now filter with `product_codes && ARRAY[...]`, which needs
-- GIN to avoid a sequential scan as the focus table grows month over month.
CREATE INDEX IF NOT EXISTS idx_focus_products_product_codes
  ON focus.focus_products USING GIN (product_codes);

COMMIT;
