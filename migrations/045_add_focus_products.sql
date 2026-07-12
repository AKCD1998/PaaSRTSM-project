BEGIN;

-- Focus products (สินค้าโฟกัส): admin-defined promotional targets.
-- Progress is computed at query time from ada.sales_lines/sales_headers
-- (see services/focusProducts.js) — this table only stores the target definition.

CREATE SCHEMA IF NOT EXISTS focus;

CREATE TABLE IF NOT EXISTS focus.focus_products (
  id            bigserial PRIMARY KEY,
  product_code  text NOT NULL,
  focus_type    text NOT NULL
    CHECK (focus_type IN ('salesperson', 'pharmacist', 'store_manager', 'group_manager')),
  target_qty    numeric(14,4) NOT NULL CHECK (target_qty > 0),
  date_from     date NOT NULL,
  date_to       date NOT NULL,
  branch_codes  text[] NULL, -- NULL = applies to all active branches
  note          text,
  is_active     boolean NOT NULL DEFAULT true,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT focus_products_date_range CHECK (date_to >= date_from)
);

CREATE INDEX IF NOT EXISTS idx_focus_products_active_range
  ON focus.focus_products (is_active, date_from, date_to);

CREATE INDEX IF NOT EXISTS idx_focus_products_type
  ON focus.focus_products (focus_type);

CREATE INDEX IF NOT EXISTS idx_focus_products_product
  ON focus.focus_products (product_code);

COMMIT;
