BEGIN;

-- Legacy recommendation workflow tables from 047 were superseded by the
-- sidecar metadata approach in 048. Drop the unused parallel workflow domain
-- to keep the live schema aligned with the current implementation.

DROP TABLE IF EXISTS ordering.stock_recommendation_events;
DROP TABLE IF EXISTS ordering.stock_recommendation_decisions;
DROP TABLE IF EXISTS ordering.stock_recommendation_request_items;
DROP TABLE IF EXISTS ordering.stock_recommendation_requests;
DROP TABLE IF EXISTS ordering.stock_recommendation_draft_lines;
DROP TABLE IF EXISTS ordering.stock_recommendation_drafts;

COMMIT;
