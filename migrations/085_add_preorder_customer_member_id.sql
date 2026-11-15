BEGIN;

ALTER TABLE customer_relations.preorder_cases
  ADD COLUMN IF NOT EXISTS customer_member_id uuid;

COMMENT ON COLUMN customer_relations.preorder_cases.customer_member_id IS
  'Stable member UUID selected from the SCCRM directory; null for contact-only preorder requests.';

COMMIT;
