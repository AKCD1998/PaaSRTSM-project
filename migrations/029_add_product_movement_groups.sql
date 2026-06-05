BEGIN;

CREATE SCHEMA IF NOT EXISTS admin;

CREATE TABLE IF NOT EXISTS admin.product_movement_groups (
  group_id bigserial PRIMARY KEY,
  group_name text NOT NULL,
  description text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_movement_groups_name_key UNIQUE (group_name)
);

CREATE TABLE IF NOT EXISTS admin.product_movement_group_items (
  group_id bigint NOT NULL REFERENCES admin.product_movement_groups(group_id) ON DELETE CASCADE,
  product_code text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, product_code)
);

CREATE INDEX IF NOT EXISTS idx_product_movement_group_items_product_code
  ON admin.product_movement_group_items (product_code);

COMMIT;
