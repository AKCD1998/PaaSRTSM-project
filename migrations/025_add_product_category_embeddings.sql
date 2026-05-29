-- Category-focused embeddings for Tier 2 similarity categorization.
-- Separate from public.sku_embeddings which encodes full SKU metadata
-- (supplier codes, pack levels, etc.) for search purposes.
-- These embeddings use ONLY the Thai + English product name so that
-- similar-type products cluster together in the vector space.

CREATE TABLE IF NOT EXISTS ada.product_category_embeddings (
  product_code       TEXT        NOT NULL PRIMARY KEY,
  embedding          vector(1536),
  embedding_model    TEXT        NOT NULL DEFAULT 'text-embedding-3-small',
  text_used          TEXT,
  content_hash       TEXT,
  embedded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW index for fast approximate nearest-neighbour search.
-- ef_construction=64 is a good default for 1536-dim, ~10k rows.
CREATE INDEX IF NOT EXISTS idx_pce_embedding_hnsw
  ON ada.product_category_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Index for incremental refresh (find stale/missing rows quickly).
CREATE INDEX IF NOT EXISTS idx_pce_updated_at
  ON ada.product_category_embeddings (updated_at DESC);
