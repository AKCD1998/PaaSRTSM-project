BEGIN;

ALTER TABLE core.branches
  ADD COLUMN IF NOT EXISTS source_system text,
  ADD COLUMN IF NOT EXISTS source_table text,
  ADD COLUMN IF NOT EXISTS source_synced_at timestamptz;

CREATE OR REPLACE VIEW ada.latest_branches AS
SELECT DISTINCT ON (b.branch_code)
  b.ada_branch_id,
  b.branch_code,
  COALESCE(NULLIF(b.branch_name, ''), NULLIF(b.branch_name_th, ''), b.branch_code) AS branch_name,
  b.branch_status,
  b.source_system,
  b.source_table,
  b.source_synced_at
FROM ada.branches b
WHERE b.branch_code IS NOT NULL
  AND b.branch_code <> ''
ORDER BY b.branch_code, b.source_synced_at DESC, b.ada_branch_id DESC;

CREATE OR REPLACE VIEW ada.latest_products AS
SELECT DISTINCT ON (p.product_code)
  p.ada_product_id,
  p.product_code,
  COALESCE(NULLIF(p.product_name, ''), NULLIF(p.product_name_th, ''), p.product_code) AS display_name,
  p.category_name,
  p.supplier_code,
  p.unit_small,
  p.factor_small,
  p.min_stock,
  p.max_stock,
  p.lead_time_days,
  p.is_active,
  p.source_system,
  p.source_table,
  p.source_synced_at
FROM ada.products p
WHERE p.product_code IS NOT NULL
  AND p.product_code <> ''
ORDER BY p.product_code, p.source_synced_at DESC, p.ada_product_id DESC;

CREATE OR REPLACE VIEW ada.latest_product_barcodes AS
SELECT DISTINCT ON (pb.product_code, pb.barcode)
  pb.ada_product_barcode_id,
  pb.product_code,
  pb.barcode,
  pb.barcode_role,
  CASE WHEN pb.barcode_role = 'primary' THEN TRUE ELSE FALSE END AS is_primary,
  pb.source_system,
  pb.source_table,
  pb.source_synced_at
FROM ada.product_barcodes pb
WHERE pb.product_code IS NOT NULL
  AND pb.product_code <> ''
  AND pb.barcode IS NOT NULL
  AND pb.barcode <> ''
ORDER BY pb.product_code, pb.barcode, pb.source_synced_at DESC, pb.ada_product_barcode_id DESC;

CREATE OR REPLACE FUNCTION ada.refresh_branches_into_core()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  affected integer := 0;
BEGIN
  INSERT INTO core.branches
    (branch_code, branch_name, is_hq, is_active, source_system, source_table, source_synced_at, updated_at)
  SELECT
    lb.branch_code,
    lb.branch_name,
    lb.branch_code = '000' AS is_hq,
    CASE
      WHEN LOWER(COALESCE(lb.branch_status, '1')) IN ('0', 'false', 'f', 'n', 'inactive', 'disabled') THEN FALSE
      ELSE TRUE
    END AS is_active,
    lb.source_system,
    lb.source_table,
    lb.source_synced_at,
    now()
  FROM ada.latest_branches lb
  ON CONFLICT (branch_code) DO UPDATE SET
    branch_name = EXCLUDED.branch_name,
    is_hq = EXCLUDED.is_hq,
    is_active = EXCLUDED.is_active,
    source_system = EXCLUDED.source_system,
    source_table = EXCLUDED.source_table,
    source_synced_at = EXCLUDED.source_synced_at,
    updated_at = now();

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION ada.refresh_products_into_public()
RETURNS TABLE(stage text, affected_rows integer)
LANGUAGE plpgsql
AS $$
DECLARE
  rowcount integer := 0;
BEGIN
  UPDATE public.items AS i
  SET
    generic_name = p.product_code,
    display_name = p.display_name,
    category_name = p.category_name,
    supplier_code = p.supplier_code,
    product_kind = COALESCE(i.product_kind, 'device_or_general_goods'),
    is_active = CASE
      WHEN LOWER(COALESCE(p.is_active, '1')) IN ('0', 'false', 'f', 'n', 'inactive', 'disabled') THEN FALSE
      ELSE TRUE
    END,
    source_company_code = p.product_code,
    source_updated_at = p.source_synced_at,
    source_updated_by = 'ada.refresh_products_into_public'
  FROM ada.latest_products p
  WHERE i.source_company_code = p.product_code;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'public.items_updated'::text, rowcount;

  INSERT INTO public.items
    (generic_name, display_name, category_name, supplier_code, product_kind, is_active, source_company_code, source_updated_at, source_updated_by)
  SELECT
    p.product_code,
    p.display_name,
    p.category_name,
    p.supplier_code,
    'device_or_general_goods',
    CASE
      WHEN LOWER(COALESCE(p.is_active, '1')) IN ('0', 'false', 'f', 'n', 'inactive', 'disabled') THEN FALSE
      ELSE TRUE
    END,
    p.product_code,
    p.source_synced_at,
    'ada.refresh_products_into_public'
  FROM ada.latest_products p
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.items i
    WHERE i.source_company_code = p.product_code
  );
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'public.items_inserted'::text, rowcount;

  INSERT INTO public.skus
    (
      item_id,
      uom,
      qty_in_base,
      pack_level,
      display_name,
      status,
      company_code,
      category_name,
      supplier_code,
      min_stock,
      max_stock,
      lead_time_days,
      source_updated_at,
      source_updated_by,
      updated_at
    )
  SELECT
    i.item_id,
    COALESCE(NULLIF(p.unit_small, ''), 'EA'),
    1,
    'base',
    p.display_name,
    p.is_active,
    p.product_code,
    p.category_name,
    p.supplier_code,
    COALESCE(p.min_stock, 0),
    COALESCE(p.max_stock, 0),
    COALESCE(p.lead_time_days, 0),
    p.source_synced_at,
    'ada.refresh_products_into_public',
    now()
  FROM ada.latest_products p
  JOIN public.items i
    ON i.source_company_code = p.product_code
  ON CONFLICT (company_code) DO UPDATE SET
    item_id = EXCLUDED.item_id,
    uom = EXCLUDED.uom,
    qty_in_base = EXCLUDED.qty_in_base,
    pack_level = EXCLUDED.pack_level,
    display_name = EXCLUDED.display_name,
    status = EXCLUDED.status,
    category_name = EXCLUDED.category_name,
    supplier_code = EXCLUDED.supplier_code,
    min_stock = EXCLUDED.min_stock,
    max_stock = EXCLUDED.max_stock,
    lead_time_days = EXCLUDED.lead_time_days,
    source_updated_at = EXCLUDED.source_updated_at,
    source_updated_by = EXCLUDED.source_updated_by,
    updated_at = now();
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'public.skus_upserted'::text, rowcount;

  DELETE FROM public.barcodes b
  USING public.skus s
  WHERE b.sku_id = s.sku_id
    AND EXISTS (
      SELECT 1
      FROM ada.latest_products p
      WHERE p.product_code = s.company_code
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ada.latest_product_barcodes pb
      WHERE pb.product_code = s.company_code
        AND pb.barcode = b.barcode
    );
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'public.barcodes_deleted'::text, rowcount;

  INSERT INTO public.barcodes
    (barcode, sku_id, is_primary, updated_at)
  SELECT
    pb.barcode,
    s.sku_id,
    pb.is_primary,
    now()
  FROM ada.latest_product_barcodes pb
  JOIN public.skus s
    ON s.company_code = pb.product_code
  ON CONFLICT (barcode) DO UPDATE SET
    sku_id = EXCLUDED.sku_id,
    is_primary = EXCLUDED.is_primary,
    updated_at = now();
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'public.barcodes_upserted'::text, rowcount;
END;
$$;

CREATE OR REPLACE FUNCTION ada.refresh_foundations()
RETURNS TABLE(stage text, affected_rows integer)
LANGUAGE plpgsql
AS $$
DECLARE
  branch_count integer := 0;
  product_row record;
BEGIN
  branch_count := ada.refresh_branches_into_core();
  RETURN QUERY SELECT 'core.branches_upserted'::text, branch_count;

  FOR product_row IN
    SELECT *
    FROM ada.refresh_products_into_public()
  LOOP
    RETURN QUERY SELECT product_row.stage::text, product_row.affected_rows::integer;
  END LOOP;
END;
$$;

COMMIT;
