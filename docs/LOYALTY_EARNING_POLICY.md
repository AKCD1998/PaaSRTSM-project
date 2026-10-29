# SCCRM purchase-point policy — 2026-10-29

Management instructed that medicine purchases may earn member points after its
consultation with the provincial public-health office. This documents the shop's
instruction, not an independent legal determination or permission for medicine
gifts/redemption.

The authenticated `/api/loyalty/products/eligibility` endpoint now returns
`eligible: true, reason: medicine_purchase_allowed` for `product_kind: medicine`.
Classification stays medicine. Unknown classifications still fail screening;
the POS API key remains required. No catalog rows, prices or native Ada data
are changed. This feature adds no migration or environment variable.

The official SCCRM backend calculates awards from validated receipt lines,
including medicines, at the existing 25-baht base rate plus active promotions.
It accepts exact older POS subtotals without trusting the local point preview.
Existing claims and historical awards stay unchanged, with duplicate protection.
SCCRMonPOS 1.3.10 also updates its preview; installing it remains optional.
