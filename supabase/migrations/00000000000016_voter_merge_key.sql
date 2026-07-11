-- ============================================================
-- Canvara Migration 16: fix the voter merge key
-- Migration 15 created a PARTIAL unique index on
-- (campaign_id, external_id). Postgres cannot infer a partial index
-- for an INSERT ... ON CONFLICT, so the merge upsert fails. Replace it
-- with a plain unique index — Postgres treats NULL external_ids as
-- distinct (NULLS DISTINCT is the default), so voters created without a
-- file ID still don't collide.
-- ============================================================

drop index if exists voters_campaign_external_uidx;

create unique index if not exists voters_campaign_external_uidx
  on voters(campaign_id, external_id);
