BEGIN;

CREATE TABLE IF NOT EXISTS public.embedding_sync_jobs (
  job_id bigserial PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('dry_run', 'execute')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  requested_by text NOT NULL,
  request_ip text,
  started_at timestamptz,
  finished_at timestamptz,
  processed_count integer NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  inserted_count integer NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  updated_count integer NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  error_summary text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  cancel_requested boolean NOT NULL DEFAULT FALSE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_embedding_sync_jobs_status_started_at_desc
  ON public.embedding_sync_jobs (status, started_at DESC, job_id DESC);

CREATE INDEX IF NOT EXISTS idx_embedding_sync_jobs_started_at_desc
  ON public.embedding_sync_jobs (started_at DESC, job_id DESC);

CREATE TABLE IF NOT EXISTS public.embedding_sync_job_items (
  id bigserial PRIMARY KEY,
  job_id bigint NOT NULL REFERENCES public.embedding_sync_jobs(job_id) ON DELETE CASCADE,
  sku_id integer,
  action text NOT NULL CHECK (action IN ('insert', 'update', 'skip', 'error')),
  content_hash_before text,
  content_hash_after text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_embedding_sync_job_items_job_id
  ON public.embedding_sync_job_items (job_id);

CREATE INDEX IF NOT EXISTS idx_embedding_sync_job_items_job_id_sku_id
  ON public.embedding_sync_job_items (job_id, sku_id);

COMMIT;
