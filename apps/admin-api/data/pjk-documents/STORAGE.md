# Permanent PJK records and on-demand PDFs

PJK records live in `pjk_documents.records`; each row freezes pharmacy/operator details, original document date, pharmacist shifts, template version and source PDF hash. The API reads PostgreSQL as its source of truth. It never returns the rendering payload or signature bytes in list responses. All routes require an admin session and use `private, no-store`.

`pjk_documents.assets` holds the original user-authorized signature PNG exactly once as a private database value. Do not commit a signature image, base64 value, SQL literal or PDF containing it. There is no raw signature download endpoint. Missing or corrupt signature data fails PDF generation closed.

PDFs are generated in memory and streamed without writing output files or storing object copies. A monthly PDF shares one embedded Thai font and signature across all pages. Historical documents use the versioned DigitalPJK template/stamping implementation in `src/services/pjk-v1/`; retain old versions when introducing future layouts.

## Initial import / recovery

1. Apply migration 079 using the repository migration protocol (never re-run the Windows runner against a Linux migration ledger).
2. Use `scripts/import_pjk_rows.js` (`importPjkRows(client, records, signatureBytes)`) with the reviewed `data/pjk-documents/records.json` and an explicitly supplied private signature file. Imports are transactional, idempotent and read back every saved payload. Existing snapshots are never silently overwritten.
3. Confirm all149 rows and the signature hash, render all8 months and compare text to reviewed PDFs before deployment.
4. Preserve the database backup plus reviewed local original ZIPs. Generated PDFs are disposable; source rows, template/font assets and signature are required to reproduce them.

Version1 renderer/template/font were ported unchanged from the existing shared DigitalPJK implementation. Only multi-page rendering and embedding the user-authorized signature were added. No DigitalPJK historical database records are changed by this import.
