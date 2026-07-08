-- ============================================================
-- Canvara Migration 11: voter geocoding (M10)
-- The worker sweeps voters that lack coordinates and resolves
-- street addresses through the Census batch geocoder. Status is
-- recorded so unmatchable addresses are attempted exactly once.
-- ============================================================

alter table voters add column if not exists geocode_status text
  check (geocode_status in ('matched','unmatched'));
alter table voters add column if not exists geocoded_at timestamptz;

-- The sweep's candidate scan: no coordinates, never attempted.
create index voters_geocode_pending_idx
  on voters(campaign_id)
  where location is null and geocode_status is null;
