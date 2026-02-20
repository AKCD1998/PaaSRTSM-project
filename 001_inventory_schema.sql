BEGIN;

-- Source-aligned inventory schema for PostgreSQL 14+.
-- ID strategy:
-- 1) IDs use GENERATED ALWAYS AS IDENTITY.
-- 2) For imports that already include IDs, use INSERT ... OVERRIDING SYSTEM VALUE.
-- 3) If you need fully manual IDs, replace identity columns with plain INTEGER.

CREATE TABLE IF NOT EXISTS public.items (
  item_id integer GENERATED ALWAYS AS IDENTITY,
  generic_name text NOT NULL,
  strength text,
  form text,
  route text,
  is_active boolean DEFAULT TRUE,
  CONSTRAINT items_pkey PRIMARY KEY (item_id),
  CONSTRAINT items_generic_name_strength_form_route_key UNIQUE (generic_name, strength, form, route)
);

CREATE TABLE IF NOT EXISTS public.skus (
  sku_id integer GENERATED ALWAYS AS IDENTITY,
  item_id integer NOT NULL,
  uom text,
  qty_in_base integer NOT NULL,
  pack_level text,
  display_name text,
  status text,
  company_code text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  uom_th text,
  CONSTRAINT skus_pkey PRIMARY KEY (sku_id),
  CONSTRAINT skus_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES public.items(item_id),
  CONSTRAINT skus_item_display_uom_qty_pack_uniq
    UNIQUE (item_id, display_name, uom, qty_in_base, pack_level),
  CONSTRAINT skus_qty_in_base_positive_chk CHECK (qty_in_base > 0)
);

CREATE TABLE IF NOT EXISTS public.barcodes (
  barcode text,
  sku_id integer NOT NULL,
  is_primary boolean NOT NULL DEFAULT FALSE,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT barcodes_pkey PRIMARY KEY (barcode),
  CONSTRAINT barcodes_sku_id_fkey
    FOREIGN KEY (sku_id) REFERENCES public.skus(sku_id)
);

CREATE TABLE IF NOT EXISTS public.prices (
  price_id integer GENERATED ALWAYS AS IDENTITY,
  sku_id integer NOT NULL,
  price numeric,
  currency text,
  effective_start timestamp without time zone,
  effective_end timestamp without time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT prices_pkey PRIMARY KEY (price_id),
  CONSTRAINT prices_sku_id_fkey
    FOREIGN KEY (sku_id) REFERENCES public.skus(sku_id)
);

CREATE TABLE IF NOT EXISTS public.item_components (
  component_id integer GENERATED ALWAYS AS IDENTITY,
  item_id integer NOT NULL,
  generic_name text,
  strength text,
  unit text,
  seq smallint,
  CONSTRAINT item_components_pkey PRIMARY KEY (component_id),
  CONSTRAINT item_components_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES public.items(item_id)
);

-- Indexes/constraints requested from source schema.
CREATE INDEX IF NOT EXISTS idx_barcodes_sku
  ON public.barcodes USING btree (sku_id);

CREATE INDEX IF NOT EXISTS barcodes_barcode_primary_idx
  ON public.barcodes USING btree (barcode)
  WHERE (is_primary IS TRUE);

CREATE INDEX IF NOT EXISTS idx_prices_sku
  ON public.prices USING btree (sku_id);

CREATE INDEX IF NOT EXISTS prices_sku_effstart_idx
  ON public.prices USING btree (sku_id, effective_start DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_skus_company_code
  ON public.skus USING btree (company_code)
  WHERE (company_code IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_components_item
  ON public.item_components USING btree (item_id);

COMMIT;
