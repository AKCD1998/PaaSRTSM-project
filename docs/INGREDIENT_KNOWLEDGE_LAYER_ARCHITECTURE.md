# Ingredient Knowledge Layer Architecture Report

## Architecture Map

The production SC StockDay admin frontend lives in `SC-StockDay-Ordering/apps/admin-web`. It is a Vite React single-page app. Its API helper in `App.jsx` uses `VITE_API_BASE_URL`, which is currently built to call the shared backend at `https://paasrtsm-project.onrender.com`.

The shared backend receiving those calls lives in `PaaSRTSM-project/apps/admin-api`. It is an Express app using raw SQL through `pg`; there is no ORM. The app is composed from route modules in `apps/admin-api/src/routes`, mounted in `apps/admin-api/src/server.js`.

Database migrations live in `PaaSRTSM-project/migrations` and are applied by `scripts/db_migrate.js`, which loads `001_inventory_schema.sql` plus sorted `.sql` migrations. Existing schemas include `public`, `ada`, `admin`, `analytics`, `ordering`, `ingest`, and `core`.

Admin authentication is cookie-session based. `apps/admin-api/src/auth/middleware.js` defines `requireAuth`, `requireRole`, and `requireCsrf`. Existing admin APIs such as `/api/admin/review-queue` use `requireAuthMiddleware` and `requireRoleMiddleware("admin")`; mutating endpoints also use CSRF.

## Current Flow

Current review queue UI:

```text
SC-StockDay-Ordering/apps/admin-web/src/App.jsx
  ReviewQueuePanel
    -> GET /api/admin/review-queue?limit=80&status=...
    -> renders product.currentCategory and product.options
    -> POST /api/admin/review-queue/confirm-batch
```

Current shared backend route:

```text
PaaSRTSM-project/apps/admin-api/src/server.js
  app.use("/api", createReviewQueueRouter(...))

PaaSRTSM-project/apps/admin-api/src/routes/review-queue.js
  GET  /admin/review-queue
  POST /admin/review-queue/confirm-batch
  GET  /admin/categories
  POST /admin/categories
```

Because the router is mounted at `/api`, the public paths are:

```text
GET  /api/admin/review-queue
POST /api/admin/review-queue/confirm-batch
GET  /api/admin/categories
POST /api/admin/categories
```

`GET /api/admin/review-queue` does the following:

1. Counts rows in `ada.product_category_states` with `review_status` in `proposed` and/or `needs_review`.
2. Loads products from `ada.product_category_states`, joining:
   - `ada.branch_stock_snapshots` for Thai/English product names and barcode fallback.
   - `public.skus` for display name fallback.
   - `ada.product_barcodes` for barcode.
3. Builds `currentCategory` from `pcs.category_name`.
4. Calls `fetchSimilarityOptions`.
5. Loads confirmed category names from `ada.product_category_states` where `review_status = 'confirmed'`.
6. Returns:

```json
{
  "total": 123,
  "limit": 80,
  "offset": 0,
  "records": [
    {
      "productCode": "IC-005863",
      "productNameThai": "...",
      "productNameEng": "...",
      "barcode": "...",
      "currentCategory": null,
      "reviewStatus": "needs_review",
      "sourceKind": "rules_batch",
      "sourceMatchLevel": "no_source_category",
      "options": []
    }
  ],
  "allCategories": ["..."]
}
```

The frontend builds visible options like this:

1. Start with `product.options`.
2. If `product.currentCategory` exists and is not already in options, prepend it.
3. If search is empty, show only the first nine options.
4. If there are no options, show `ไม่พบหมวดที่ตรงกับคำค้น...`.
5. Category search can search `allCategories`, but with an empty search it does not display the full category dictionary.

`POST /api/admin/review-queue/confirm-batch` writes human decisions into `ada.product_category_states` with:

```text
review_status = 'confirmed'
source_kind = 'human'
source_reference = 'review_queue'
source_match_level = 'human_review'
```

## Current Categorization Logic

The categorization batch lives in:

```text
PaaSRTSM-project/apps/admin-api/src/categorization/index.js
PaaSRTSM-project/apps/admin-api/src/categorization/tier0.js
PaaSRTSM-project/apps/admin-api/src/categorization/tier1.js
PaaSRTSM-project/apps/admin-api/src/categorization/tier2.js
PaaSRTSM-project/apps/admin-api/src/categorization/embed.js
```

Current tier flow:

```text
ada.branch_stock_snapshots
  -> Tier 0 exact taxonomy match
  -> Tier 1 raw category / alias / shelf-rule normalization
  -> Tier 2 pgvector similarity fallback
  -> ada.product_category_states
```

Tier 0 uses exact taxonomy match data and writes `review_status = imported_exact_match`.

Tier 1 uses `public.typo_aliases` and `public.category_shelf_rules`. If a raw source category exists and has a known rule, it writes `proposed` unless `always_human_confirm` is true. If the raw category is missing or unknown, it writes `needs_review`.

Tier 2 uses `ada.product_category_embeddings` and pgvector. It only upgrades `needs_review` products when:

- The query product has an embedding.
- Reference products have embeddings.
- Reference products are already categorized.
- Similarity is above threshold.

Review queue option generation also uses `ada.product_category_embeddings`, but only to list similar category options. It does not parse drug ingredients.

Important limitation: `public.sku_embeddings` and `ada.product_category_embeddings` are separate systems. SKU embeddings are for SKU search; category embeddings are for category suggestion. Running one does not guarantee the other is populated.

## Relevant Tables

Product/source tables:

- `public.skus`: SKU/product metadata, including `company_code`, `display_name`, `category_name`, `supplier_code`.
- `public.items`: item metadata joined by `item_id`.
- `ada.products`: ADA product mirror, including product code/name/category fields.
- `ada.product_barcodes`: product barcode mirror.
- `ada.branch_stock_snapshots`: branch stock snapshot and product name source used by review queue.

Category/review tables:

- `ada.product_category_states`: current category overlay and human review status.
- `public.category_shelf_rules`: known clean categories and shelf metadata.
- `public.typo_aliases`: raw category aliases to canonical categories.
- taxonomy map/workbook tables referenced by categorization Tier 0.

Embedding tables:

- `ada.product_category_embeddings`: category-focused embeddings from Thai and English product names.
- `public.sku_embeddings`: SKU search embeddings with richer SKU metadata.

Audit/log tables:

- `public.audit_logs`: general admin audit logging used by auth/product flows.
- `ada.product_category_states` contains lightweight previous category/status fields but not full review history.

## Why LODOS Can Still Have No Suggestion

For a product like:

```text
MERCK LODOS BISOPROLOL FUMARATE 2.5 MG. HYDROCHLOROTHIAZIDE 6.25 MG.
```

a pharmacist can infer:

```text
Bisoprolol -> beta blocker -> hypertension/cardiovascular
Hydrochlorothiazide -> thiazide diuretic -> hypertension/edema
```

The current system does not have a first-class ingredient dictionary. It does not tokenize active ingredients, map them to drug classes, or infer indication-driven product categories. It can only use raw category data, taxonomy exact matches, rules over raw category labels, and vector similarity to already categorized products.

If this product has no raw category, no exact taxonomy match, no category embedding, or no similar reference product above threshold, backend returns `options: []`; the frontend then shows the empty-option message.

## Risks And Unknowns

- Production may not have `ada.product_category_embeddings` fully populated for all products.
- `runCategorizationBatch` may not run automatically after every relevant import in all deployment paths.
- Category names are currently free-text strings, not stable category IDs.
- Product identity is mostly `product_code` / SKU code, not a single normalized product table ID.
- Active ingredients may appear in English names, Thai names, abbreviations, misspellings, and combination-product formats.
- Drug class and indication taxonomies need pharmacist review; hardcoding a few examples in route logic would not scale.
- Some drug classes map to multiple possible store categories, so ingredient-based suggestions should produce ranked suggestions with rationale, not silently overwrite.
- Medical categorization can be safety-sensitive; human confirmation should remain required before final category state changes.

## Minimal Additive Schema Proposal

Prefer a new schema, for example `knowledge`, to avoid overloading existing `ada` mirror tables and `public` import tables.

```sql
CREATE SCHEMA IF NOT EXISTS knowledge;

CREATE TABLE knowledge.ingredients (
  ingredient_id bigserial PRIMARY KEY,
  canonical_name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'needs_review')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge.ingredient_synonyms (
  synonym_id bigserial PRIMARY KEY,
  ingredient_id bigint NOT NULL REFERENCES knowledge.ingredients(ingredient_id) ON DELETE CASCADE,
  synonym_text text NOT NULL,
  language text,
  source text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'needs_review')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ingredient_id, synonym_text)
);

CREATE TABLE knowledge.drug_classes (
  drug_class_id bigserial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  parent_class_id bigint REFERENCES knowledge.drug_classes(drug_class_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge.ingredient_drug_classes (
  ingredient_id bigint NOT NULL REFERENCES knowledge.ingredients(ingredient_id) ON DELETE CASCADE,
  drug_class_id bigint NOT NULL REFERENCES knowledge.drug_classes(drug_class_id) ON DELETE CASCADE,
  confidence numeric,
  source text,
  status text NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('proposed', 'confirmed', 'rejected')),
  confirmed_by text,
  confirmed_at timestamptz,
  PRIMARY KEY (ingredient_id, drug_class_id)
);

CREATE TABLE knowledge.indications (
  indication_id bigserial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge.ingredient_indications (
  ingredient_id bigint NOT NULL REFERENCES knowledge.ingredients(ingredient_id) ON DELETE CASCADE,
  indication_id bigint NOT NULL REFERENCES knowledge.indications(indication_id) ON DELETE CASCADE,
  source text,
  status text NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('proposed', 'confirmed', 'rejected')),
  confirmed_by text,
  confirmed_at timestamptz,
  PRIMARY KEY (ingredient_id, indication_id)
);

CREATE TABLE knowledge.product_ingredients (
  product_code text NOT NULL,
  ingredient_id bigint NOT NULL REFERENCES knowledge.ingredients(ingredient_id),
  strength text,
  unit text,
  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'confirmed', 'rejected')),
  confidence numeric,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_code, ingredient_id, source)
);

CREATE TABLE knowledge.ingredient_category_rules (
  rule_id bigserial PRIMARY KEY,
  ingredient_id bigint REFERENCES knowledge.ingredients(ingredient_id) ON DELETE CASCADE,
  drug_class_id bigint REFERENCES knowledge.drug_classes(drug_class_id) ON DELETE CASCADE,
  indication_id bigint REFERENCES knowledge.indications(indication_id) ON DELETE CASCADE,
  category_name text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  rule_status text NOT NULL DEFAULT 'active'
    CHECK (rule_status IN ('active', 'inactive', 'needs_review')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ingredient_id IS NOT NULL OR drug_class_id IS NOT NULL OR indication_id IS NOT NULL)
);

CREATE TABLE knowledge.ingredient_suggestion_audit (
  audit_id bigserial PRIMARY KEY,
  product_code text NOT NULL,
  suggested_ingredient_ids bigint[],
  suggested_category_name text,
  rationale jsonb NOT NULL DEFAULT '{}'::jsonb,
  action text NOT NULL
    CHECK (action IN ('suggested', 'confirmed', 'edited', 'rejected')),
  actor_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

This design stays additive and keeps `ada.product_category_states` as the existing final category overlay.

## Backend API Proposal

Read APIs first:

```text
GET /api/admin/products/:productCode/ingredient-suggestions
```

Returns detected ingredients, confirmed product ingredients, drug classes, indications, category suggestions, and rationale.

```text
GET /api/admin/ingredients?search=
GET /api/admin/ingredients/:ingredientId
GET /api/admin/drug-classes
GET /api/admin/indications
```

Dictionary management:

```text
POST /api/admin/ingredients
PUT  /api/admin/ingredients/:ingredientId
POST /api/admin/ingredients/:ingredientId/synonyms
PUT  /api/admin/ingredients/:ingredientId/drug-classes
PUT  /api/admin/ingredients/:ingredientId/indications
```

Human supervision:

```text
PUT /api/admin/products/:productCode/ingredients
```

Payload:

```json
{
  "ingredients": [
    {
      "ingredientId": 1,
      "strength": "2.5",
      "unit": "mg",
      "status": "confirmed"
    }
  ]
}
```

Ingredient category rules:

```text
GET  /api/admin/ingredient-category-rules
POST /api/admin/ingredient-category-rules
PUT  /api/admin/ingredient-category-rules/:ruleId
```

Review queue integration:

```text
GET /api/admin/review-queue?...&include_ingredient_suggestions=1
```

This should add a field to each record without changing current fields:

```json
{
  "ingredientSuggestions": [
    {
      "ingredient": "Bisoprolol",
      "drugClass": "Beta blocker",
      "indications": ["Hypertension"],
      "categoryName": "ยาความดัน/หัวใจ",
      "confidence": 0.9,
      "rationale": "Matched synonym BISOPROLOL in English product name"
    }
  ]
}
```

Category confirmation should remain via the existing `confirm-batch` endpoint initially.

## Frontend Proposal

Keep `ReviewQueuePanel` behavior intact and add an optional ingredient supervisor section under the product metadata.

Suggested read-only first UI:

```text
Product name
Product code/barcode

Suggested ingredients
  - Bisoprolol 2.5 mg
    Beta blocker
    Hypertension / cardiovascular
  - Hydrochlorothiazide 6.25 mg
    Thiazide diuretic
    Hypertension / edema

Category rationale
  Suggested because Bisoprolol maps to Beta blocker -> Cardiovascular
```

Then add controls:

- Confirm ingredient.
- Reject ingredient.
- Add ingredient manually.
- Edit strength/unit.
- Assign drug class.
- Assign indication.
- Pick or create category rule.

For minimal disruption, ingredient-based category suggestions should appear as additional category option buttons with a clear label, for example:

```text
1  ยาความดัน/หัวใจ  ingredient rule
2  ...              86% similarity
```

A separate Ingredient Dictionary admin page is appropriate once the basic panel works.

## Integration Strategy

Phase 1: This architecture report.

Phase 2: Add migrations only for `knowledge.*` tables. No route changes.

Phase 3: Add backend read APIs for ingredient dictionary and product ingredient suggestions. Keep suggestions conservative and read-only.

Phase 4: Add frontend read-only ingredient panel in `ReviewQueuePanel`. Preserve current category buttons.

Phase 5: Add human confirmation/update APIs for product ingredients, synonyms, drug classes, indications, and category rules.

Phase 6: Use confirmed ingredient knowledge to enhance `/api/admin/review-queue` options. Ingredient suggestions should be additive and ranked before or alongside embedding options; do not remove embedding similarity.

Phase 7: Add audit/history, backfill jobs, and batch detection from product names.

## Suggested Phase 2 Codex Prompt

```text
Implement Phase 2 only for the Ingredient Knowledge Layer.

Repository: PaaSRTSM-project.

Do not change frontend behavior and do not add API routes yet.

Add a migration under migrations/ that creates an additive knowledge schema for supervised ingredient learning. Include:
- knowledge.ingredients
- knowledge.ingredient_synonyms
- knowledge.drug_classes
- knowledge.ingredient_drug_classes
- knowledge.indications
- knowledge.ingredient_indications
- knowledge.product_ingredients
- knowledge.ingredient_category_rules
- knowledge.ingredient_suggestion_audit

Use raw SQL consistent with existing migrations.
Do not modify ada.product_category_states or existing embedding tables.
Add indexes for common lookups:
- ingredient canonical/display names
- synonym_text
- product_ingredients product_code
- ingredient_category_rules category_name/status

Run npm test after adding the migration.
Report the migration file path and any assumptions.
```
