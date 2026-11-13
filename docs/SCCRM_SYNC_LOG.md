# SCCRM member sync log gateway

The existing admin-only SCCRM member directory adds:

- `GET /api/admin/sccrm-members/:id/sync-status`
- `POST /api/admin/sccrm-members/:id/sync-status/retry` with `{jobId}`.

Reads use the existing server-side CRM mirror credential. Retry additionally
requires the authenticated admin's CSRF token and existing private Ada-link
admin credential. The gateway supplies the actor from its signed session; the
browser cannot change member, branch, receipt or actor on retry.

The upstream must return the requested member's ID and bounded job/event lists.
Credentials are not returned to the browser. Invalid inputs never call upstream;
upstream failures become safe errors with no-cache responses. No application
database migration or new public secret is needed. Deploy this API explicitly
after merging; the StockDay frontend's automatic deploy does not deploy PaaS.
