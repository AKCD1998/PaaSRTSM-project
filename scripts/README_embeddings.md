# SKU Embeddings (PostgreSQL + pgvector)

## 1) Run migration
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/012_add_sku_embeddings.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/013_add_embedding_sync_jobs.sql
```

## 2) Environment
```bash
export EMBEDDING_PROVIDER=mock
export EMBEDDING_MODEL=text-embedding-3-small
export EMBEDDING_DIM=1536
```

OpenAI mode:
```bash
export EMBEDDING_PROVIDER=openai
export OPENAI_API_KEY=...
export EMBEDDING_MODEL=text-embedding-3-small
export EMBEDDING_DIM=1536
```

## 3) Backfill (safe by default)
Dry-run:
```bash
node scripts/backfill_sku_embeddings.js --db-url "$DATABASE_URL"
```

Execute:
```bash
node scripts/backfill_sku_embeddings.js --execute --db-url "$DATABASE_URL"
```

## 4) Incremental sync (stale/missing only)
Dry-run:
```bash
node scripts/sync_sku_embeddings.js --db-url "$DATABASE_URL"
```

Execute:
```bash
node scripts/sync_sku_embeddings.js --execute --db-url "$DATABASE_URL"
```

Since timestamp:
```bash
node scripts/sync_sku_embeddings.js --execute --since "2026-02-01T00:00:00Z" --db-url "$DATABASE_URL"
```

## 5) API endpoints
- Health: `GET /api/search/health`
- Hybrid SKU search (admin/staff auth required): `GET /api/search/skus?q=...&k=20&product_kind=medicine&level=base`
- Async sync trigger (admin + CSRF): `POST /api/search/skus/sync`
- Sync jobs list (admin): `GET /api/search/skus/sync/jobs?limit=50`
- Sync job detail (admin): `GET /api/search/skus/sync/jobs/:job_id?items_limit=200`
- Sync cancel (admin + CSRF): `POST /api/search/skus/sync/jobs/:job_id/cancel`

Example curl (search):
```bash
curl -b "admin_session=<session-cookie>" \
  "http://localhost:3001/api/search/skus?q=amoxicillin&k=10&product_kind=medicine"
```

## 6) SQL snippet (manual hybrid query)
```sql
-- $1 is vector literal like '[0.1,0.2,...]'
SELECT
  s.sku_id,
  s.company_code,
  s.display_name,
  s.product_kind,
  (1 - (e.embedding <=> $1::vector))::double precision AS similarity_score
FROM public.sku_embeddings e
JOIN public.skus s ON s.sku_id = e.sku_id
WHERE s.product_kind = 'medicine'
ORDER BY similarity_score DESC
LIMIT 20;
```

## 7) Notes
- Embeddings are for retrieval only, not pricing/totals.
- Price must come from `public.prices` (SQL) for deterministic billing.
- Migration attempts `HNSW`; if unavailable it falls back to `IVFFLAT`.
- For `IVFFLAT`, tune `lists` for dataset size and run `ANALYZE` after bulk load.
- Sync trigger endpoint is rate-limited to 1 request/minute/admin.
- Only one active sync job is allowed at a time (`queued` or `running`); additional triggers return `409`.
