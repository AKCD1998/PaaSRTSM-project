# Public SCCRM registration entry

The shared PaaSRTSM admin API serves the mobile-friendly registration selector at
`https://paasrtsm-project.onrender.com/sccrm` (with or without a trailing slash).
No app installation, LINE Mini App, customer login or frontend build is required.

The page has exactly two choices:

- Customer self-registration opens the existing live form at
  `https://sc-official-website.onrender.com/join`. That service still writes to the
  existing Supabase CRM database and owns validation, consent and duplicates.
- Staff-assisted registration opens the existing SCCRMV2 web app at
  `https://sccrmv2.onrender.com`. Its existing staff authentication remains required.

This entry is navigation only. It accepts no registration payloads, sets no
session cookie, queries no database, and does not move CRM data into `sc_drug_db`.
Email, LINE and Google customer signup are not exposed. The existing direct QR
link to `/join` remains valid. Assets and styles are local; there is no JavaScript,
analytics, service worker, environment variable or additional dependency.

## Validation and deployment

Run `node --test tests/crm_web.test.js` and the existing CI suite. Check the page
and both destinations in a browser at desktop and mobile viewport sizes.

The production service tracks `main`, auto-deploys after CI checks pass, runs
`npm run db:migrate` before deployment, and checks `/admin/health`. Before merging,
compare the exact tracked migration filenames with `public.schema_migrations`.
This feature adds no migrations. A read-only preflight on 2026-10-21 confirmed
every migration on base commit `a45aed16ad7a66d809bdc44db2ad26a8a7b23f67`
was already recorded, including `073` and `074`, using forward slashes.

Verify the new Render deployment is live, then check `/sccrm`, its CSS/icon,
`/admin/health`, the public form and the staff login. Also verify `/admin/me` still
rejects an unauthenticated request. Do not treat an accepted deploy as a live one.

Rollback consists of reverting the public router mount and its files; there is
no database change to reverse. This web entry deploys separately from the Expo
SCCRMMVP app; changing the Expo app is not required to use this web URL.

Local validation on 2026-10-21: the complete test runner passed 530 checks, with
191 database-dependent checks skipped locally. GitHub CI supplies its own isolated
Postgres databases for those integration checks. Browser checks at 320, 390, 768
and 1280 CSS pixels found no horizontal overflow and both links had 54-pixel tap
targets. The staff link opened the existing PIN/device login page.
