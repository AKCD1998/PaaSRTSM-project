BEGIN;

CREATE TABLE IF NOT EXISTS focus.line_chat_packages (
  id                 bigserial PRIMARY KEY,
  package_key        text NOT NULL UNIQUE,
  focus_type         text NOT NULL
    CHECK (focus_type IN ('salesperson', 'pharmacist', 'store_manager', 'group_manager')),
  branch_code        text NOT NULL,
  date_from          date NOT NULL,
  date_to            date NOT NULL,
  ci_count           integer NOT NULL CHECK (ci_count >= 0),
  message_text       text NOT NULL CHECK (length(message_text) BETWEEN 1 AND 4000),
  row_fingerprint    text NOT NULL,
  image_sha256       text NOT NULL,
  bucket_name        text NOT NULL,
  object_key         text NOT NULL,
  mime_type          text NOT NULL DEFAULT 'image/png',
  size_bytes         integer NOT NULL CHECK (size_bytes > 0),
  upload_state       text NOT NULL DEFAULT 'ready'
    CHECK (upload_state IN ('ready', 'cleanup_pending', 'deleted')),
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL DEFAULT (now() + interval '35 days')
);

CREATE INDEX IF NOT EXISTS idx_focus_line_chat_packages_expires
  ON focus.line_chat_packages (expires_at)
  WHERE upload_state = 'ready';

CREATE INDEX IF NOT EXISTS idx_focus_line_chat_packages_context
  ON focus.line_chat_packages (focus_type, branch_code, date_from, date_to, created_at DESC);

COMMIT;
