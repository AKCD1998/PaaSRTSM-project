BEGIN;

-- Default embedding dimension aligns with OpenAI text-embedding-3-small.
-- If you switch to a model with different dimension, add a follow-up migration.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.sku_embeddings (
  id bigserial PRIMARY KEY,
  sku_id integer NOT NULL,
  embedding vector(1536) NOT NULL,
  embedding_dim smallint NOT NULL CHECK (embedding_dim > 0),
  embedding_model text NOT NULL,
  embedding_provider text NOT NULL,
  text_for_embedding text NOT NULL,
  content_hash text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_updated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sku_embeddings_sku_id_fkey
    FOREIGN KEY (sku_id) REFERENCES public.skus(sku_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_sku_embeddings_sku_id
  ON public.sku_embeddings (sku_id);

CREATE INDEX IF NOT EXISTS idx_sku_embeddings_updated_at_desc
  ON public.sku_embeddings (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sku_embeddings_metadata_product_type
  ON public.sku_embeddings ((metadata->>'product_type'));

CREATE INDEX IF NOT EXISTS idx_sku_embeddings_metadata_level
  ON public.sku_embeddings ((metadata->>'level'));

CREATE INDEX IF NOT EXISTS idx_sku_embeddings_metadata_gin
  ON public.sku_embeddings USING gin (metadata jsonb_path_ops);

DO $$
BEGIN
  IF to_regclass('public.idx_sku_embeddings_embedding_hnsw') IS NULL
    AND to_regclass('public.idx_sku_embeddings_embedding_ivfflat') IS NULL THEN
    BEGIN
      EXECUTE '
        CREATE INDEX idx_sku_embeddings_embedding_hnsw
          ON public.sku_embeddings USING hnsw (embedding vector_cosine_ops)
      ';
    EXCEPTION
      WHEN undefined_object OR feature_not_supported OR invalid_parameter_value THEN
        EXECUTE '
          CREATE INDEX idx_sku_embeddings_embedding_ivfflat
            ON public.sku_embeddings USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 100)
        ';
        EXECUTE 'ANALYZE public.sku_embeddings';
    END;
  END IF;
END $$;

COMMIT;
