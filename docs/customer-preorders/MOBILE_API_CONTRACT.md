# PDA preorder API contract

This adapter exposes the existing customer preorder case API to an enrolled PDA client. The Android client still needs to call these routes; the adapter does not create a second case store or a second source of truth.

## Authentication and access

- Send the existing enrolled-device token as `Authorization: Bearer <token>`.
- The API revalidates the enrollment and revocation/expiry state against `ordering.enrolled_devices` on every request.
- A mobile identity is mapped to the server-side subject `staff:<staff_id>`. Configure an explicit branch grant in `PREORDER_WORKSPACE_PROFILES`, for example `staff:123=branch:001`.
- Mobile branch access is limited to the enrolled device's branch and the `branch` preorder workspace. The server ignores client-supplied role or branch claims. `X-Preorder-Workspace` cannot grant a role absent from that staff profile.
- Branch `000` is not eligible for this branch PDA adapter; HQ roles remain assigned through their existing web identities.
- All APIs remain unavailable unless the preorder feature, role workspace, and mobile PDA flags are enabled.
- The API's CORS preflight allows `Authorization` for clients making cross-origin requests.
- Cookie-authenticated web mutations continue to require `X-CSRF-Token`. A verified mobile Bearer request uses the enrolled-device token and does not use cookie CSRF.

## Endpoints

The PDA uses the same paths, request/response shapes, case IDs, and idempotency behavior as the web client under `/api/customer-preorders`:

- `GET /workspace`
- `GET /product-suggestions?q=...`
- `GET /cases` and `GET /cases/:publicId`
- `POST /cases` to create preorder and price-inquiry cases
- `POST /cases/:publicId/read`
- `POST /cases/:publicId/messages`
- The branch-capability workflow actions exposed by the router, including customer decisions, arrival confirmation, customer notification, completion, and cancellation

Multipart images use the same existing attachment flow and upload limits. The client should keep and retry the same `idempotencyKey` when a create request times out.

## Not included in this adapter

- SCCRM member lookup/create and member sync receipt endpoints.
- Offline case creation or background upload queue.
- Any ADA write, product creation, or stock mutation.
- HQ fulfillment and purchasing access through PDA.

Those require their own reviewed contracts and integration paths. Enabling this adapter alone does not make preorder production-ready.
