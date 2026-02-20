BEGIN;

CREATE TABLE IF NOT EXISTS public.audit_logs (
  audit_id bigserial PRIMARY KEY,
  event_time timestamptz NOT NULL DEFAULT now(),
  actor_role text NOT NULL CHECK (actor_role IN ('admin', 'staff', 'system')),
  actor_id text,
  action text NOT NULL,
  target_type text,
  target_id text,
  success boolean NOT NULL DEFAULT TRUE,
  message text,
  meta jsonb,
  request_id text,
  ip text,
  user_agent text
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_event_time_desc
  ON public.audit_logs (event_time DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON public.audit_logs (action);

CREATE INDEX IF NOT EXISTS idx_audit_logs_target
  ON public.audit_logs (target_type, target_id);

COMMIT;
