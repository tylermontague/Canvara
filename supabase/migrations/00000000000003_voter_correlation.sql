-- ============================================================
-- Canvara Migration 3: GPS → voter correlation (IE-3)
-- Nearest geocoded voter in the campaign within a radius.
-- Called by the worker (service role); manual canvasser override
-- (conversations.voter_id_manual) always wins and is checked in code.
-- ============================================================

create or replace function correlate_voter(
  p_campaign_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_max_meters double precision default 75
) returns table (voter_id uuid, distance_m double precision)
language sql stable as $$
  select
    v.id,
    st_distance(
      v.location,
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
    ) as distance_m
  from voters v
  where v.campaign_id = p_campaign_id
    and v.location is not null
    and st_dwithin(
      v.location,
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
      p_max_meters
    )
  order by distance_m asc
  limit 1
$$;
