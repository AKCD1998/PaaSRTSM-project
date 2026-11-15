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
- `GET /members/lookup?phone=...` returns active SCCRM members whose primary or linked phone exactly matches. It returns `matchKind` (`none`, `single`, or `multiple`) and only the ID/name/member code needed for selection.
- `GET /product-suggestions?q=...`
- `GET /cases` and `GET /cases/:publicId`
- `POST /cases` to create preorder and price-inquiry cases
- `POST /cases/:publicId/read`
- `POST /cases/:publicId/messages`
- The branch-capability workflow actions exposed by the router, including customer decisions, arrival confirmation, customer notification, completion, and cancellation

Multipart images use the same existing attachment flow and upload limits. The client should keep and retry the same `idempotencyKey` when a create request times out.
When an existing member is selected, include its `customerMemberId` in `POST /cases`. The API repeats the exact phone/member check against SCCRM, uses the canonical member name and persists the member UUID on the preorder case. Keep the phone entered by the staff member as the contact phone for this request.

## In-app notifications

The receipt/case inbox poll is separate from the case routes above:

- `GET /api/mobile/preorder-notifications?afterId=0&limit=30` (also mounted as `/api/pda/preorder-notifications`)
- Use the same enrolled-device Bearer. The response contains `items`, a monotonically increasing `nextAfterId`, and `pollingRecommendedSeconds: 30`; persist `nextAfterId` and pass it on the next poll. This is in-app polling, not an OS push notification.
- HQ device branch `000` receives `HQ_RECEIPT_SYNCED` work cues, including the linked request/item and approved receipt source details. These are generated in the same backend transaction that ingests approved HQ receipt records, deduplicated by source document/line and preorder item. They mean “review/count this synced receipt”; they do not mean the physical quantity was verified, allocated, dispatched or delivered.
- A branch device receives `HQ_RECEIPT_LINKED` only after HQ's FIFO allocation commits. It does not receive the HQ sync event or its source details. Notification items omit the customer's phone and name.
- The endpoints require the mobile-PDA, customer-preorder and preorder-role-workspace feature flags. The receipt-only scheduled task is configured by `apps/adapos-sync/register-preorder-receipt-task.ps1` for a 15-minute cadence, but the script creates it disabled unless explicitly enabled; this code does not confirm that it is installed/enabled on the live HQ host.

The web workspace uses a separate 30-second `/api/customer-preorders/unread-count` badge poll. That badge and the PDA polling endpoint do not constitute real-time push delivery.

## Not included in this adapter

- Creating a new SCCRM member from PDA and returning its ADA/branch sync receipt.
- Offline case creation or background upload queue.
- Any ADA write, product creation, or stock mutation.
- HQ fulfillment and purchasing access through PDA.

New member creation is not exposed by this adapter: the existing SCCRM staff registration route requires a separate revocable staff-device credential, date of birth and general PDPA consent. The current PDA enrollment token is a different credential. The existing SCCRM source documents a background Ada/HQ-to-branch member delivery worker, but its deployed health still needs an operational check. The PDA client has not integrated the case API or notification poll, the receipt-task live state is unknown, and enabling this adapter alone does not make preorder production-ready.
