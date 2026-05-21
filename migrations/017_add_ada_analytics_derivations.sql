BEGIN;

CREATE OR REPLACE VIEW ada.stock_snapshot_rollups_for_analytics AS
SELECT
  ss.product_code,
  ss.snapshot_at,
  SUM(COALESCE(ss.qty_base, ss.qty_on_hand, 0))::numeric(14,4) AS stock_current_base
FROM ada.stock_snapshots ss
WHERE ss.product_code IS NOT NULL
  AND ss.product_code <> ''
GROUP BY ss.product_code, ss.snapshot_at;

CREATE OR REPLACE FUNCTION ada.refresh_stock_snapshots_into_analytics()
RETURNS TABLE(stage text, affected_rows integer)
LANGUAGE plpgsql
AS $$
DECLARE
  rowcount integer := 0;
BEGIN
  DELETE FROM analytics.product_stock_snapshots
  WHERE source_name = 'ada_derived';
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'analytics.product_stock_snapshots_deleted'::text, rowcount;

  INSERT INTO analytics.product_stock_snapshots
    (product_code, snapshot_at, stock_current, stock_retail, stock_warehouse, source_name, created_at)
  SELECT
    r.product_code,
    r.snapshot_at,
    r.stock_current_base,
    0::numeric(14,4),
    0::numeric(14,4),
    'ada_derived',
    now()
  FROM ada.stock_snapshot_rollups_for_analytics r
  JOIN public.skus s
    ON s.company_code = r.product_code;

  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'analytics.product_stock_snapshots_inserted'::text, rowcount;
END;
$$;

CREATE OR REPLACE FUNCTION ada.refresh_sales_summary_period_into_analytics(p_period_days integer DEFAULT 30)
RETURNS TABLE(stage text, affected_rows integer)
LANGUAGE plpgsql
AS $$
DECLARE
  rowcount integer := 0;
  period_end_value date;
  period_start_value date;
BEGIN
  IF p_period_days IS NULL OR p_period_days <= 0 THEN
    RAISE EXCEPTION 'p_period_days must be a positive integer';
  END IF;

  SELECT MAX(sh.doc_date)
  INTO period_end_value
  FROM ada.sales_headers sh
  WHERE sh.doc_date IS NOT NULL
    AND LOWER(COALESCE(sh.paid_status, '')) IN ('1', 'true', 't', 'paid', 'success', 'y');

  DELETE FROM analytics.product_sales_summary_periods
  WHERE source_name = 'ada_derived'
    AND period_days = p_period_days;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'analytics.product_sales_summary_periods_deleted'::text, rowcount;

  IF period_end_value IS NULL THEN
    RETURN QUERY SELECT 'analytics.product_sales_summary_periods_inserted'::text, 0;
    RETURN;
  END IF;

  period_start_value := period_end_value - (p_period_days - 1);

  INSERT INTO analytics.product_sales_summary_periods
    (
      product_code,
      branch_code,
      period_start,
      period_end,
      period_days,
      sold_qty_base,
      avg_daily_usage,
      source_name,
      created_at
    )
  SELECT
    sl.product_code,
    sh.branch_code,
    period_start_value,
    period_end_value,
    p_period_days,
    SUM(COALESCE(sl.qty_base, sl.qty * NULLIF(sl.stock_factor, 0), sl.qty, 0))::numeric(14,4),
    ROUND(
      (
        SUM(COALESCE(sl.qty_base, sl.qty * NULLIF(sl.stock_factor, 0), sl.qty, 0))
        / p_period_days::numeric
      )::numeric,
      4
    )::numeric(14,4),
    'ada_derived',
    now()
  FROM ada.sales_lines sl
  JOIN ada.sales_headers sh
    ON sh.branch_code = sl.branch_code
   AND sh.doc_no = sl.doc_no
  JOIN public.skus s
    ON s.company_code = sl.product_code
  JOIN core.branches b
    ON b.branch_code = sh.branch_code
  WHERE sh.doc_date BETWEEN period_start_value AND period_end_value
    AND LOWER(COALESCE(sh.paid_status, '')) IN ('1', 'true', 't', 'paid', 'success', 'y')
  GROUP BY sl.product_code, sh.branch_code;

  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'analytics.product_sales_summary_periods_inserted'::text, rowcount;
END;
$$;

CREATE OR REPLACE FUNCTION ada.refresh_purchase_summary_period_into_analytics(p_period_days integer DEFAULT 30)
RETURNS TABLE(stage text, affected_rows integer)
LANGUAGE plpgsql
AS $$
DECLARE
  rowcount integer := 0;
  period_end_value date;
  period_start_value date;
BEGIN
  IF p_period_days IS NULL OR p_period_days <= 0 THEN
    RAISE EXCEPTION 'p_period_days must be a positive integer';
  END IF;

  SELECT MAX(ph.doc_date)
  INTO period_end_value
  FROM ada.purchase_headers ph
  WHERE ph.doc_date IS NOT NULL
    AND LOWER(COALESCE(ph.doc_status, '')) NOT IN ('0', 'cancelled', 'canceled', 'void');

  DELETE FROM analytics.product_purchase_summary_periods
  WHERE source_name = 'ada_derived'
    AND period_days = p_period_days;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'analytics.product_purchase_summary_periods_deleted'::text, rowcount;

  IF period_end_value IS NULL THEN
    RETURN QUERY SELECT 'analytics.product_purchase_summary_periods_inserted'::text, 0;
    RETURN;
  END IF;

  period_start_value := period_end_value - (p_period_days - 1);

  INSERT INTO analytics.product_purchase_summary_periods
    (
      product_code,
      period_start,
      period_end,
      period_days,
      purchased_qty_base,
      source_name,
      created_at
    )
  SELECT
    pl.product_code,
    period_start_value,
    period_end_value,
    p_period_days,
    SUM(COALESCE(pl.qty_base, pl.qty * NULLIF(pl.stock_factor, 0), pl.qty, 0))::numeric(14,4),
    'ada_derived',
    now()
  FROM ada.purchase_lines pl
  JOIN ada.purchase_headers ph
    ON ph.branch_code = pl.branch_code
   AND ph.doc_no = pl.doc_no
  JOIN public.skus s
    ON s.company_code = pl.product_code
  WHERE ph.doc_date BETWEEN period_start_value AND period_end_value
    AND LOWER(COALESCE(ph.doc_status, '')) NOT IN ('0', 'cancelled', 'canceled', 'void')
  GROUP BY pl.product_code;

  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'analytics.product_purchase_summary_periods_inserted'::text, rowcount;
END;
$$;

CREATE OR REPLACE FUNCTION ada.refresh_analytics(p_period_days integer DEFAULT 30)
RETURNS TABLE(stage text, affected_rows integer)
LANGUAGE plpgsql
AS $$
DECLARE
  result_row record;
BEGIN
  FOR result_row IN
    SELECT *
    FROM ada.refresh_stock_snapshots_into_analytics()
  LOOP
    RETURN QUERY SELECT result_row.stage::text, result_row.affected_rows::integer;
  END LOOP;

  FOR result_row IN
    SELECT *
    FROM ada.refresh_sales_summary_period_into_analytics(p_period_days)
  LOOP
    RETURN QUERY SELECT result_row.stage::text, result_row.affected_rows::integer;
  END LOOP;

  FOR result_row IN
    SELECT *
    FROM ada.refresh_purchase_summary_period_into_analytics(p_period_days)
  LOOP
    RETURN QUERY SELECT result_row.stage::text, result_row.affected_rows::integer;
  END LOOP;
END;
$$;

COMMIT;
