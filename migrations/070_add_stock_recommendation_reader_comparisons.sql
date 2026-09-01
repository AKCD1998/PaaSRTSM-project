BEGIN;

-- WP3 reader-shadow evidence only. Keep this bounded: digests, aggregate
-- counts, generation IDs, and at most a small set of identifiers. Stock and
-- recommendation payloads do not belong in this table.
CREATE TABLE IF NOT EXISTS ordering.stock_recommendation_reader_comparisons (
  comparison_id uuid PRIMARY KEY,
  reader_mode text NOT NULL
    CHECK (reader_mode = 'shadow'),
  served_reader text NOT NULL
    CHECK (served_reader = 'legacy'),
  comparison_status text NOT NULL
    CHECK (comparison_status IN ('match', 'mismatch', 'unavailable', 'error')),
  branch_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  legacy_digest text NULL
    CHECK (legacy_digest IS NULL OR legacy_digest ~ '^[0-9a-f]{64}$'),
  normalized_digest text NULL
    CHECK (normalized_digest IS NULL OR normalized_digest ~ '^[0-9a-f]{64}$'),
  mismatch_counts jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(mismatch_counts) = 'object'),
  mismatch_examples jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (
      jsonb_typeof(mismatch_examples) = 'array'
      AND jsonb_array_length(mismatch_examples) <= 12
    ),
  input_counts jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(input_counts) = 'object'),
  input_generations jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(input_generations) = 'array'),
  availability jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(availability) = 'object'),
  source_snapshot text NULL,
  served_source text NULL
    CHECK (served_source IS NULL OR served_source = 'precomputed'),
  served_anchor_date date NULL,
  served_target_days integer NULL
    CHECK (served_target_days IS NULL OR served_target_days > 0),
  served_snapshot_generated_at timestamptz NULL,
  served_row_count integer NULL
    CHECK (served_row_count IS NULL OR served_row_count >= 0),
  served_branch_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  duration_ms integer NULL CHECK (duration_ms IS NULL OR duration_ms >= 0),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_reader_comparisons_completed
  ON ordering.stock_recommendation_reader_comparisons (completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_reader_comparisons_status
  ON ordering.stock_recommendation_reader_comparisons (
    comparison_status,
    completed_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_reader_comparisons_expiry
  ON ordering.stock_recommendation_reader_comparisons (expires_at);

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_reader_comparisons_served_snapshot
  ON ordering.stock_recommendation_reader_comparisons (
    served_snapshot_generated_at DESC
  )
  WHERE served_snapshot_generated_at IS NOT NULL;

COMMIT;
