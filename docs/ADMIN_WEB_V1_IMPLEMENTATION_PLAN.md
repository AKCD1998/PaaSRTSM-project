# ADMIN WEB V1 IMPLEMENTATION PLAN

This plan translates the locked requirements into implementation structure only.  
No production code is included in this document.

## 1) Proposed Repository Layout
```text
apps/
  admin-api/
    src/
      app.js
      server.js
      config/
      middleware/
      routes/
      controllers/
      services/
      repositories/
      validators/
      auth/
      jobs/
      lib/
    tests/
  admin-web/
    src/
      app/
      pages/
      components/
      features/
      api/
      hooks/
      auth/
      utils/
    public/
    tests/
packages/
  shared/            # optional shared types/validation constants
docs/
```

Rationale:
- Keeps existing root `scripts/` and migrations untouched.
- Creates clean separation between API and web app for Render deployment.

## 2) Tech Stack Choice
## 2.1 API: Node + Express
Why:
- Matches current Node runtime and existing script ecosystem.
- Minimal overhead to integrate with current `pg` and import logic.
- Straightforward middleware model for auth, RBAC, validation, rate limiting.

## 2.2 Web: React + Vite
Why:
- Fast setup and iteration for internal admin UI.
- Clear route/page model for the locked V1 scope.
- Easy integration with REST API and role-based UI controls.

## 3) Render Deployment Shape
Recommended services:
1. `admin-api` as Render Web Service
2. `admin-web` as Render Static Site (or Web Service if needed)

Environment:
- API stores DB/session secrets in Render env vars.
- Web stores only safe public config (API base URL).

## 4) Server-Side Import Execution (Safe Design)
Goal:
- UI uploads CSV, API executes imports safely without shell injection risk.

## 4.1 Preferred approach (V1)
Refactor existing importer scripts into callable functions:
- Keep CLI entrypoints for existing operations.
- Extract core logic into reusable modules, e.g.:
  - `scripts/lib/adapos_import.js`
  - `scripts/lib/sales_import.js`
  - `scripts/lib/enrichment_apply.js`
- API calls module functions directly with validated option objects.

Benefits:
- No shell command construction from user input.
- Better typed validation and error handling.
- Easier testing and auditing.

## 4.2 Fallback approach (only if needed)
Use process spawning safely:
- `spawn`/`execFile` with fixed executable and fixed script path.
- Never use shell interpolation.
- Whitelist arguments (`mode`, `price_history`, `apply_rules`, `limit` etc.).
- Reject unknown args and unsafe filenames.

## 4.3 File upload handling
- Store uploaded file in temporary server storage with generated filename.
- Enforce size/type limits.
- Parse/validate request metadata before running import.
- Delete temp files after run (success/fail).

## 5) RBAC and Route Guard Plan
Roles:
- `admin`: full V1 access.
- `staff`: read-only.

Middleware layers:
1. Authentication middleware
2. Role authorization middleware
3. Endpoint-level validator middleware

Denied actions from `staff`:
- `PUT /admin/products/:sku_id`
- `POST /admin/import/products`
- `POST /admin/import/prices`
- `POST /admin/enrichment/apply-rules`

## 6) API Scope for V1
Planned endpoints:
- `POST /admin/auth/login`
- `POST /admin/auth/logout`
- `GET /admin/me`
- `GET /admin/health`
- `GET /admin/products`
- `GET /admin/products/:sku_id`
- `PUT /admin/products/:sku_id`
- `POST /admin/import/products` (dry-run/commit)
- `POST /admin/import/prices` (dry-run/commit)
- `GET /admin/enrichment/top-sellers`
- `POST /admin/enrichment/apply-rules` (dry-run/commit)

Not V1:
- enrichment rules CRUD endpoints.

## 7) Audit Log Implementation Direction
Requirement lock includes new table `audit_logs`.

Planned behavior:
- Write audit record for:
  - auth events
  - product edits
  - import runs
  - apply-rules runs
- Persist request id, actor, event type, status, and details payload.

Note:
- DB migration/table creation is planned for implementation phase, not in this document-only phase.

## 8) UI Surface Plan (V1)
Pages:
- Dashboard
- Product List/Search
- Product Detail/Edit
- Imports (Products + Monthly Price)
- Top Sellers To Enrich
- Apply Rules

UX controls:
- Role-based disabling/hiding for staff write actions.
- Dry-run before commit flows on imports and apply-rules.
- Confirmation modal before commit actions.
- Toast + structured result summary after each run.

## 9) Security Controls Checklist (Implementation)
- Secure session cookies: `HttpOnly`, `Secure`, `SameSite`.
- CSRF protection for state-changing routes.
- Password hashing (argon2id/bcrypt).
- Login rate limit and brute-force protection.
- Import endpoint rate limits.
- Input/file validation and strict parser behavior.
- No arbitrary command execution.
- Structured audit logging for all sensitive actions.

## 10) Execution Order (when implementation starts)
1. Bootstrap `apps/admin-api` skeleton + auth/session/RBAC.
2. Bootstrap `apps/admin-web` skeleton + login + role-aware routing.
3. Refactor import/enrichment scripts into callable modules.
4. Add product read/edit APIs and pages.
5. Add import APIs/pages with dry-run/commit.
6. Add enrichment top-sellers + apply-rules APIs/pages.
7. Add audit_logs migration + write hooks.
8. Add smoke tests and deployment docs.
