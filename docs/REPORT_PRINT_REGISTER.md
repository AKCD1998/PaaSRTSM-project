# Central paper-print register

StockDay `#/report-print-register` lists KY9/KY10/KY11 document versions by branch, reporting period and month. This is an admin-only document register. It never sends a print job, writes stock, changes Ada, or treats a generated/downloaded PDF as paper printing.

`report_print_register.documents` stores immutable version/file references, page count, optional SHA-256 and optional month-to-parent-PDF page mappings. Combined all-branch PDFs and monthly copies of the same parent are not separate print confirmations. An unmapped multi-month document remains visibly a whole-document record; its entire page count must not be reported as one month's page count.

`events` contains explicit paper-print confirmations with exact page ranges or an explicitly unknown page scope. Actual print date, copy count and printer may remain null. Recording time is separate. An unknown range does not mean the whole file. Page coverage is the union of active confirmations, so overlapping ranges and repeated requests do not inflate coverage. A stable request UUID makes retries idempotent. Incorrect confirmations are voided by a new event with a reason; originals remain immutable.

Photos/user statements that cannot yet be tied to an exact file version remain in `unmapped_evidence`, outside every document's confirmed-page coverage. No source business evidence or patient data is bundled in Git. Initial history is privately imported after deployment with its source/manifest references. A user-confirmed historical print is labelled as such, never as a printer receipt; unknown dates and copy counts remain unknown.

API: authenticated admin GET `/api/admin/report-print-register` (kind, branch, month, version, status filters), GET `/:id` (history), and CSRF-protected POST document, `/:id/confirmations`, and `/:id/confirmations/:eventId/void`. Creating a document produces no print event. There are no UPDATE/DELETE endpoints. Both the API and database reject history overwrite.

Migration 085 adds this schema only. It does not add stock or dispensing triggers. The deployment must also inspect any already-pending migrations on main; never run the whole migration chain from a stale checkout. Tests cover validation, absent proof, unknown scope/date, overlapping coverage, month mappings, idempotent retries, immutable corrections, role/CSRF gates and actual isolated PostgreSQL persistence.
