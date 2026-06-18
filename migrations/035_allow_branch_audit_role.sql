BEGIN;

-- WP-00 introduced the `branch` role, but admin.audit_logs (migration 010) still
-- constrained actor_role to ('admin','staff','system'). Any audited branch-user
-- action (e.g. branch login) therefore violated the CHECK and failed. Align the
-- constraint with auth/audit ALLOWED_ROLES. Additive and backward-compatible.

ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_role_check;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_actor_role_check
  CHECK (actor_role IN ('admin', 'staff', 'branch', 'system'));

COMMIT;
