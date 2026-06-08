BEGIN;

CREATE SCHEMA IF NOT EXISTS knowledge;

CREATE TABLE IF NOT EXISTS knowledge.ingredients (
  ingredient_id bigserial PRIMARY KEY,
  canonical_name text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'needs_review', 'deprecated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingredients_canonical_name_key UNIQUE (canonical_name)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ingredients_canonical_name_normalized
  ON knowledge.ingredients (LOWER(BTRIM(canonical_name)));

CREATE INDEX IF NOT EXISTS idx_ingredients_status
  ON knowledge.ingredients (status, canonical_name);

CREATE TABLE IF NOT EXISTS knowledge.ingredient_synonyms (
  synonym_id bigserial PRIMARY KEY,
  ingredient_id bigint NOT NULL REFERENCES knowledge.ingredients(ingredient_id) ON DELETE CASCADE,
  synonym_text text NOT NULL,
  language text,
  source text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'needs_review', 'deprecated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ingredient_synonyms_text_normalized
  ON knowledge.ingredient_synonyms (LOWER(BTRIM(synonym_text)));

CREATE INDEX IF NOT EXISTS idx_ingredient_synonyms_ingredient_id
  ON knowledge.ingredient_synonyms (ingredient_id);

CREATE INDEX IF NOT EXISTS idx_ingredient_synonyms_status
  ON knowledge.ingredient_synonyms (status, synonym_text);

CREATE TABLE IF NOT EXISTS knowledge.drug_classes (
  drug_class_id bigserial PRIMARY KEY,
  name text NOT NULL,
  parent_class_id bigint REFERENCES knowledge.drug_classes(drug_class_id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'needs_review', 'deprecated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drug_classes_name_key UNIQUE (name)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_drug_classes_name_normalized
  ON knowledge.drug_classes (LOWER(BTRIM(name)));

CREATE INDEX IF NOT EXISTS idx_drug_classes_parent_class_id
  ON knowledge.drug_classes (parent_class_id);

CREATE INDEX IF NOT EXISTS idx_drug_classes_status
  ON knowledge.drug_classes (status, name);

CREATE TABLE IF NOT EXISTS knowledge.ingredient_drug_classes (
  ingredient_id bigint NOT NULL REFERENCES knowledge.ingredients(ingredient_id) ON DELETE CASCADE,
  drug_class_id bigint NOT NULL REFERENCES knowledge.drug_classes(drug_class_id) ON DELETE CASCADE,
  confidence numeric(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  source text,
  status text NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('proposed', 'confirmed', 'rejected', 'needs_review')),
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ingredient_id, drug_class_id)
);

CREATE INDEX IF NOT EXISTS idx_ingredient_drug_classes_drug_class_id
  ON knowledge.ingredient_drug_classes (drug_class_id);

CREATE INDEX IF NOT EXISTS idx_ingredient_drug_classes_status
  ON knowledge.ingredient_drug_classes (status, ingredient_id);

CREATE TABLE IF NOT EXISTS knowledge.indications (
  indication_id bigserial PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'needs_review', 'deprecated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT indications_name_key UNIQUE (name)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_indications_name_normalized
  ON knowledge.indications (LOWER(BTRIM(name)));

CREATE INDEX IF NOT EXISTS idx_indications_status
  ON knowledge.indications (status, name);

CREATE TABLE IF NOT EXISTS knowledge.ingredient_indications (
  ingredient_id bigint NOT NULL REFERENCES knowledge.ingredients(ingredient_id) ON DELETE CASCADE,
  indication_id bigint NOT NULL REFERENCES knowledge.indications(indication_id) ON DELETE CASCADE,
  source text,
  status text NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('proposed', 'confirmed', 'rejected', 'needs_review')),
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ingredient_id, indication_id)
);

CREATE INDEX IF NOT EXISTS idx_ingredient_indications_indication_id
  ON knowledge.ingredient_indications (indication_id);

CREATE INDEX IF NOT EXISTS idx_ingredient_indications_status
  ON knowledge.ingredient_indications (status, ingredient_id);

CREATE TABLE IF NOT EXISTS knowledge.product_ingredients (
  product_code text NOT NULL,
  ingredient_id bigint NOT NULL REFERENCES knowledge.ingredients(ingredient_id) ON DELETE RESTRICT,
  strength_value numeric(14,4),
  strength_unit text,
  raw_text text,
  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'confirmed', 'rejected', 'needs_review')),
  confidence numeric(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_code, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_product_ingredients_ingredient_id
  ON knowledge.product_ingredients (ingredient_id);

CREATE INDEX IF NOT EXISTS idx_product_ingredients_status
  ON knowledge.product_ingredients (status, product_code);

CREATE INDEX IF NOT EXISTS idx_product_ingredients_confirmed_at
  ON knowledge.product_ingredients (confirmed_at DESC);

CREATE TABLE IF NOT EXISTS knowledge.ingredient_category_rules (
  rule_id bigserial PRIMARY KEY,
  ingredient_id bigint REFERENCES knowledge.ingredients(ingredient_id) ON DELETE CASCADE,
  drug_class_id bigint REFERENCES knowledge.drug_classes(drug_class_id) ON DELETE CASCADE,
  indication_id bigint REFERENCES knowledge.indications(indication_id) ON DELETE CASCADE,
  category_name text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  rule_status text NOT NULL DEFAULT 'active'
    CHECK (rule_status IN ('active', 'inactive', 'needs_review', 'deprecated')),
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingredient_category_rules_has_source_check
    CHECK (ingredient_id IS NOT NULL OR drug_class_id IS NOT NULL OR indication_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_ingredient_category_rules_ingredient_id
  ON knowledge.ingredient_category_rules (ingredient_id);

CREATE INDEX IF NOT EXISTS idx_ingredient_category_rules_drug_class_id
  ON knowledge.ingredient_category_rules (drug_class_id);

CREATE INDEX IF NOT EXISTS idx_ingredient_category_rules_indication_id
  ON knowledge.ingredient_category_rules (indication_id);

CREATE INDEX IF NOT EXISTS idx_ingredient_category_rules_category_name
  ON knowledge.ingredient_category_rules (category_name);

CREATE INDEX IF NOT EXISTS idx_ingredient_category_rules_active_priority
  ON knowledge.ingredient_category_rules (rule_status, priority, rule_id);

CREATE TABLE IF NOT EXISTS knowledge.ingredient_suggestion_audit (
  audit_id bigserial PRIMARY KEY,
  product_code text NOT NULL,
  suggestion_type text NOT NULL
    CHECK (suggestion_type IN ('ingredient', 'drug_class', 'indication', 'category')),
  suggested_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'accepted', 'rejected', 'superseded')),
  resolved_by text,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingredient_suggestion_audit_product_code
  ON knowledge.ingredient_suggestion_audit (product_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingredient_suggestion_audit_status
  ON knowledge.ingredient_suggestion_audit (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingredient_suggestion_audit_type
  ON knowledge.ingredient_suggestion_audit (suggestion_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingredient_suggestion_audit_payload_gin
  ON knowledge.ingredient_suggestion_audit USING gin (suggested_payload jsonb_path_ops);

COMMIT;
