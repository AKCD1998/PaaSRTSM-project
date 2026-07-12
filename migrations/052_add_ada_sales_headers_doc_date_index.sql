BEGIN;

-- Focus-products progress queries (services/focusProducts.js) filter
-- ada.sales_headers by doc_date across ALL branches for a date range, with no
-- branch_code predicate. The existing idx_ada_sales_headers_branch_date index
-- leads with branch_code, so it can't be used for an all-branch date-range
-- scan — Postgres was falling back to scanning ada.sales_lines by product_code
-- across a product's ENTIRE history (idx_ada_sales_lines_product_date has no
-- date bound) before joining back to headers and filtering by date, which is
-- why a 26-product batched query still took ~20s in production.
--
-- This index lets the planner start from doc_date instead: find headers in
-- the target month first (a much smaller set), then join to sales_lines via
-- the existing (branch_code, doc_no, ...) unique index.

CREATE INDEX IF NOT EXISTS idx_ada_sales_headers_doc_date
  ON ada.sales_headers (doc_date, branch_code, doc_no);

COMMIT;
