BEGIN;

-- Follow-up to migration 052. EXPLAIN ANALYZE against production (see
-- session notes) showed the plain (doc_date, branch_code, doc_no) index from
-- 052 was still being ignored by the planner in favor of a much worse index,
-- because the raw_payload->>'...' JSONB filter can't be pushed into a plain
-- btree index — Postgres had to heap-fetch and evaluate it per candidate row
-- regardless of which index started the scan. A *partial* index whose
-- predicate matches that exact filter lets Postgres pre-filter at the index
-- level (confirmed: Index Only Scan, 0 heap fetches).
--
-- Second bottleneck found the same way: the existing sales_lines unique
-- index is (branch_code, doc_no, line_no, product_code) — line_no sits
-- between doc_no and product_code, so a query that constrains branch_code +
-- doc_no + product_code but not line_no can't seek directly to matching
-- lines; it has to scan every line of every matching receipt. A dedicated
-- (branch_code, doc_no, product_code) index fixes that.
--
-- Combined effect on the focus-products sold-qty query (26 products, one
-- month, all branches): ~26s -> ~2.9s in production.
--
-- The plain doc_date index from 052 is superseded by the partial index below
-- and is dropped to avoid paying its write-time maintenance cost for no
-- remaining benefit.

DROP INDEX IF EXISTS ada.idx_ada_sales_headers_doc_date;

CREATE INDEX IF NOT EXISTS idx_ada_sales_headers_paid_doc_date
  ON ada.sales_headers (doc_date, branch_code, doc_no)
  WHERE COALESCE(NULLIF(raw_payload->>'FTShdDocType', ''), '1') = '1'
    AND COALESCE(NULLIF(raw_payload->>'FTShdStaPaid', ''), paid_status, '') = '3';

CREATE INDEX IF NOT EXISTS idx_ada_sales_lines_branch_doc_product
  ON ada.sales_lines (branch_code, doc_no, product_code);

COMMIT;
