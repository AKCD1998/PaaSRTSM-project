BEGIN;

CREATE TABLE IF NOT EXISTS public.supplier_logos (
  supplier_key text PRIMARY KEY,
  supplier_name text NOT NULL,
  logo_data_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
