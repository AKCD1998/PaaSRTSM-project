# Admin Web V1 Proposal

## 1) Repo Inspection Summary
Current repo is **CLI + SQL only**:
- No existing backend web framework (`express/fastify/nest`) found.
- No frontend app (`react/vite/next`) found.
- No existing auth/session/login implementation found.
- DB access is script-level via direct `pg` usage in `scripts/*.js`.
- Current scripts/migrations/tests are stable and should remain isolated.

Implication:
- Admin Web should be added as a **new app surface** without changing current import/enrichment CLI flows by default.

## 2) Recommended Architecture (Render + In-house Auth)
### Proposed baseline
- `apps/admin-api` (Node + Express REST API)
- `apps/admin-web` (React + Vite SPA)
- `packages/shared` (optional: shared validators/types/api client)

### Why this structure
- Keeps existing root scripts intact.
- Enables phased rollout: API first, then UI.
- Fits Render deployment well as two services:
  - Render Web Service 1: Admin API (private env vars, DB access)
  - Render Static Site (or Web Service) 2: Admin Web

### Auth recommendation (in-house)
- Cookie-based session auth (server-managed sessions) is preferred for internal admin tools.
- Role model configurable for either:
  - `admin-only`
  - `admin + staff`

Note: exact role scope and permissions are still unconfirmed.

## 3) Minimal Page Scope Proposals (choose one)
### Option A (smallest, fastest)
- Dashboard
- Product Search/List
- Product Detail/Edit (limited editable fields)
- Import page (trigger existing import pipeline)

### Option B (recommended V1)
- Option A plus:
- Enrichment Top Sellers page
- Apply Rules page (dry-run + commit)

### Option C (broader V1)
- Option B plus:
- Enrichment Rule CRUD page
- Import run history/audit page

## 4) Minimal API Proposal
- `GET /admin/health`
- `POST /admin/auth/login`
- `POST /admin/auth/logout`
- `GET /admin/me`
- `GET /admin/products`
- `GET /admin/products/:sku_id`
- `PUT /admin/products/:sku_id`
- `POST /admin/import/products` (dry-run/commit)
- `POST /admin/import/prices` (dry-run/commit)
- `GET /admin/enrichment/top-sellers`
- `POST /admin/enrichment/apply-rules` (dry-run/commit)
- Optional for broader scope:
  - `GET /admin/enrichment/rules`
  - `POST /admin/enrichment/rules`
  - `PUT /admin/enrichment/rules/:rule_id`
  - `PATCH /admin/enrichment/rules/:rule_id/enable`

## 5) Conservative Default Data Fields (No Business Logic Changes)
### Product list (read)
- `sku_id`
- `company_code`
- `display_name`
- `category_name`
- `supplier_code`
- `product_kind`
- `enrichment_status`
- current retail price (`prices` active row)
- `updated_at`

### Product detail (read)
- All list fields
- barcodes
- wholesale tiers
- drug/enrichment fields:
  - `generic_name`
  - `strength_text`
  - `form`
  - `route`
  - `enrichment_notes`
  - `enriched_at`
  - `enriched_by`

### Conservative editable defaults
- `display_name`
- `category_name`
- `supplier_code`
- `product_kind`
- `generic_name`
- `strength_text`
- `form`
- `route`
- `enrichment_status`
- `enrichment_notes`

Not proposed for direct edit in V1 by default:
- legacy `items` uniqueness key fields, PK/FK fields, importer identity keys.

## 6) Import Integration Options
### A) Server-side upload + importer modules
- Upload CSV in web UI, API stores temp file, calls shared importer functions.
- Preferred long-term UX.
- Requires refactoring current script entrypoints into reusable library modules.

### B) UI as control panel + CLI instructions only
- UI shows exact commands and status guidance; import still run by operator CLI.
- Lowest risk and fastest, but weaker UX.

Recommendation:
- If V1 speed is critical: start with **B**.
- If operational simplicity is priority: choose **A**.

## 7) Security Checklist (In-house Auth on Render)
- Session cookies: `HttpOnly`, `Secure`, `SameSite=Lax/Strict`.
- CSRF protection on all state-changing endpoints.
- Password hashing (Argon2id or bcrypt with strong cost).
- Login rate limiting + brute-force lockout/backoff.
- Endpoint rate limiting for import/enrichment actions.
- Strict input validation (schema validation for all API payloads).
- Role-based authorization middleware (`admin`, optional `staff`).
- File upload hard limits (size/type), no shell execution from user input.
- Audit for auth events + imports + edits (if enabled by policy).
- Render secrets in env vars only; no credentials in repo.

## 8) Missing Answers Required Before Implementation
Still required from your side:
1. UI scope selection (Option A/B/C or custom).
2. Final field policy:
   - exactly which fields are editable in Product Detail.
3. Import workflow choice:
   - Option A (server upload + run) or Option B (CLI-guided only) for V1.
4. Price policy in UI:
   - default `price-only`?
   - allow `price-history on` toggle?
5. Enrichment policy:
   - manual drug fact edits allowed?
   - rule CRUD allowed in UI for V1?
6. Auth role model final:
   - `admin-only` or `admin+staff`, and staff permissions if used.
7. Audit log requirement:
   - mandatory for V1?
   - storage design (new DB table) and required event scope.

## 9) Explicit Stop
No UI or DB implementation should start until items in section 8 are confirmed.
