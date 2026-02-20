BEGIN;

CREATE TABLE IF NOT EXISTS public.sales_daily (
  sale_date date NOT NULL,
  company_code text NOT NULL,
  sku_id integer,
  qty numeric(14,3) NOT NULL CHECK (qty >= 0),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_daily_pkey PRIMARY KEY (sale_date, company_code),
  CONSTRAINT sales_daily_sku_id_fkey
    FOREIGN KEY (sku_id) REFERENCES public.skus(sku_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_daily_sale_date
  ON public.sales_daily (sale_date);

CREATE INDEX IF NOT EXISTS idx_sales_daily_company_code
  ON public.sales_daily (company_code);

CREATE INDEX IF NOT EXISTS idx_sales_daily_sku_id
  ON public.sales_daily (sku_id);

COMMIT;
