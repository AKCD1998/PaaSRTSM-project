# Admin Web (V1)

React + Vite SPA for inventory admin workflows.

## Features in V1
- Login (cookie session via Admin API)
- Role-aware UI (`admin` / `staff`)
- Dashboard
- Product Search/List
- Product Detail/Edit (10 editable fields; staff read-only)
- Imports:
  - Import Products (dry-run + commit)
  - Monthly Price Update (price-only default, history toggle)
- Enrichment:
  - Top sellers report
  - Apply rules (dry-run + commit, admin only)
- Loading overlay, toast notifications, and commit confirmation modal

## Prerequisites
- Admin API running and reachable at `VITE_ADMIN_API_BASE`
- Node.js 18+

## Setup
```bash
cd apps/admin-web
npm install
```

Create env file:
```bash
cp .env.example .env
```

Adjust:
```env
VITE_ADMIN_API_BASE=http://localhost:3001
```

If you run repo-level scripts from this checkout, keep database settings in the repo root shell or in `apps/admin-api/.env`, not in tracked example files. For the current Render-hosted Postgres setup, `DATABASE_URL` must be a complete connection string with a fully qualified host and `PGSSLMODE=require`.

## Run (dev)
```bash
cd apps/admin-web
npm run dev
```

## Build
```bash
cd apps/admin-web
npm run build
```

## Preview build
```bash
cd apps/admin-web
npm run preview
```

## Notes
- API calls send cookies (`credentials: include`).
- CSRF token is fetched from `/admin/me` and sent on state-changing routes.
- Commit actions are disabled until a matching dry-run has completed.
