BEGIN;

CREATE OR REPLACE FUNCTION ada.refresh_analytics_windows(p_period_days integer[])
RETURNS TABLE(stage text, affected_rows integer)
LANGUAGE plpgsql
AS $$
DECLARE
  requested_days integer;
  result_row record;
BEGIN
  IF p_period_days IS NULL OR array_length(p_period_days, 1) IS NULL THEN
    RAISE EXCEPTION 'p_period_days must contain at least one positive integer';
  END IF;

  FOREACH requested_days IN ARRAY p_period_days
  LOOP
    IF requested_days IS NULL OR requested_days <= 0 THEN
      RAISE EXCEPTION 'p_period_days must contain only positive integers';
    END IF;
  END LOOP;

  FOR result_row IN
    SELECT *
    FROM ada.refresh_stock_snapshots_into_analytics()
  LOOP
    RETURN QUERY SELECT result_row.stage::text, result_row.affected_rows::integer;
  END LOOP;

  FOREACH requested_days IN ARRAY p_period_days
  LOOP
    FOR result_row IN
      SELECT *
      FROM ada.refresh_sales_summary_period_into_analytics(requested_days)
    LOOP
      RETURN QUERY
      SELECT
        format('%s[%sd]', result_row.stage, requested_days)::text,
        result_row.affected_rows::integer;
    END LOOP;

    FOR result_row IN
      SELECT *
      FROM ada.refresh_purchase_summary_period_into_analytics(requested_days)
    LOOP
      RETURN QUERY
      SELECT
        format('%s[%sd]', result_row.stage, requested_days)::text,
        result_row.affected_rows::integer;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION ada.refresh_analytics(p_period_days integer DEFAULT 30)
RETURNS TABLE(stage text, affected_rows integer)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM ada.refresh_analytics_windows(ARRAY[p_period_days]);
END;
$$;

CREATE OR REPLACE FUNCTION ada.refresh_analytics_standard_windows()
RETURNS TABLE(stage text, affected_rows integer)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM ada.refresh_analytics_windows(ARRAY[7, 30, 90]);
END;
$$;

COMMIT;
