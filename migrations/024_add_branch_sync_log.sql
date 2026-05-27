-- Migration 024: branch sync log
-- Adds laptop heartbeat tracking so the admin "ประวัติ Sync" calendar grid can
-- distinguish "sync failed" from "laptop was off" per branch per night.
--
-- The branch sync runs themselves already live in ingest.sync_runs with
-- sync_type values like 'adapos_branch_005'. We derive branch_code from that
-- pattern at query time, so no schema change to sync_runs is needed.

CREATE TABLE IF NOT EXISTS ingest.laptop_heartbeats (
  heartbeat_id  bigserial PRIMARY KEY,
  branch_code   text        NOT NULL,
  laptop_name   text,
  event         text        NOT NULL DEFAULT 'startup',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_laptop_heartbeats_branch_created
  ON ingest.laptop_heartbeats (branch_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_laptop_heartbeats_created
  ON ingest.laptop_heartbeats (created_at DESC);
