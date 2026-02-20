# ADMIN WEB V1 REQUIREMENTS LOCK

Date locked: 2026-02-20

This document freezes the confirmed V1 requirements and access rules.  
No scope expansion beyond this document is included in V1.

## 1) Confirmed Decisions
- Hosting target: Render
- Auth model: in-house login
- Roles: `admin`, `staff`
- Role policy: `staff` is read-only (no edits, no imports, no apply-rules)
- V1 scope: **Option B**
  - Dashboard
  - Product List/Search
  - Product Detail/Edit
  - Imports (Products + Monthly Price Update)
  - Top Sellers To Enrich
  - Apply Rules
- Product detail editable fields:
  - `display_name`
  - `category_name`
  - `supplier_code`
  - `product_kind`
  - `enrichment_status`
  - `enrichment_notes`
  - `generic_name`
  - `strength_text`
  - `form`
  - `route`
- Import workflow: server-side upload + server runs importer
- Price policy:
  - default `price-only`: yes
  - `price-history` toggle: yes
- Enrichment policy:
  - manual edits: yes
  - rule CRUD in UI: later (not V1)
- Audit log: required
  - new DB table: `audit_logs`
  - log auth events + product edits + import runs + apply rules

## 2) V1 Page List and Capabilities
## 2.1 Dashboard
- Show quick links to all V1 pages.
- Show latest import/apply-rules run summaries from audit logs.
- No write action.

## 2.2 Product List/Search
- Filter by keyword, category, supplier, product kind, enrichment status.
- Paginated table.
- Open product detail page.
- No direct table inline edit in V1.

## 2.3 Product Detail/Edit
- Read:
  - product baseline data
  - enrichment fields
  - current retail price
  - wholesale tiers
  - optional price history block (read-only)
- Edit (admin only):
  - exactly the 10 locked editable fields listed in section 1.

## 2.4 Imports
- Products import:
  - upload CSV
  - mode select: `full` or `price-only`
  - apply-rules toggle
  - dry-run preview
  - commit
- Monthly price update:
  - upload CSV
  - default `price-only`
  - allow `price-history` toggle
  - dry-run preview
  - commit

## 2.5 Top Sellers To Enrich
- Inputs: top N, since date.
- Output: top seller SKUs not yet `verified`.
- Read-only page.

## 2.6 Apply Rules
- Dry-run rules execution.
- Commit rules execution.
- Show per-rule summary.
- No rule create/edit/delete in V1.

## 3) Page Permissions Matrix
| Page | Admin | Staff |
|---|---|---|
| Dashboard | read | read |
| Product List/Search | read | read |
| Product Detail | read + edit | read |
| Imports (Products) | dry-run + commit | no access |
| Imports (Monthly Price) | dry-run + commit | no access |
| Top Sellers To Enrich | read | read |
| Apply Rules | dry-run + commit | no access |

## 4) Endpoint Permissions Matrix
| Endpoint | Admin | Staff |
|---|---|---|
| `POST /admin/auth/login` | allow | allow |
| `POST /admin/auth/logout` | allow | allow |
| `GET /admin/me` | allow | allow |
| `GET /admin/health` | allow | allow |
| `GET /admin/products` | allow | allow |
| `GET /admin/products/:sku_id` | allow | allow |
| `PUT /admin/products/:sku_id` | allow | deny |
| `POST /admin/import/products` | allow | deny |
| `POST /admin/import/prices` | allow | deny |
| `GET /admin/enrichment/top-sellers` | allow | allow |
| `POST /admin/enrichment/apply-rules` | allow | deny |

Rule CRUD endpoints are excluded from V1.

## 5) Exact Audit Events to Log
Event names are fixed for V1:

## 5.1 Auth events
- `auth.login_success`
- `auth.login_failed`
- `auth.logout`

## 5.2 Product edit events
- `product.update`
  - include target `sku_id`, `company_code`
  - include changed field list
  - include before/after snapshot for only changed fields

## 5.3 Import events
- `import.products.dry_run`
- `import.products.commit_started`
- `import.products.commit_succeeded`
- `import.products.commit_failed`
- `import.prices.dry_run`
- `import.prices.commit_started`
- `import.prices.commit_succeeded`
- `import.prices.commit_failed`

Import event payload must include:
- mode (`full|price-only`)
- price_history (`on|off`) when relevant
- apply_rules flag when relevant
- source filename
- summary counts (inserted/updated/skipped/errors/conflicts)

## 5.4 Enrichment apply-rules events
- `enrichment.apply_rules.dry_run`
- `enrichment.apply_rules.commit_started`
- `enrichment.apply_rules.commit_succeeded`
- `enrichment.apply_rules.commit_failed`

Payload must include:
- filters used (`only_status`, `limit`, `force`)
- per-rule matched/updated/skipped counts

## 5.5 Required common audit columns (for future table design)
- `audit_id`
- `event_type`
- `actor_user_id` (nullable for failed login before user resolution)
- `actor_role` (`admin|staff|system`)
- `request_id` (for tracing)
- `resource_type`
- `resource_id`
- `status` (`success|failed|denied`)
- `details_json`
- `created_at`

## 6) Explicit V1 Exclusions
- Rule CRUD UI/API
- Multi-tenant
- Advanced ingredient normalization workflows
- Non-admin write delegation for staff
