-- ============================================================
-- Canvara Migration 14: security hardening (certification)
--  1. Pin search_path on SECURITY DEFINER / helper functions so a
--     tenant cannot hijack function resolution to escalate across
--     campaigns (Supabase "Function Search Path Mutable" advisory).
--  2. Make audit_log append-only: members may read and write entries
--     but never UPDATE or DELETE them — the audit trail is evidence.
-- ============================================================

-- ---------- 1. Fixed search_path on the tenancy functions ----------
-- Every RLS policy calls these two; they are the root of the tenant
-- firewall. Running SECURITY DEFINER with a mutable search_path lets a
-- role that can create objects on the path shadow `profiles` or built-in
-- operators. Pin to empty and schema-qualify every reference.

create or replace function current_campaign_id() returns uuid
language sql stable security definer
set search_path = ''
as $$
  select campaign_id from public.profiles where id = auth.uid()
$$;

create or replace function current_role_in_campaign() returns text
language sql stable security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- correlate_voter is invoker-run (called by the service-role worker) and
-- takes only typed parameters (no dynamic SQL), but pin its search_path
-- too so PostGIS operator resolution can't be shadowed. Recreated with
-- fully-qualified names.
create or replace function correlate_voter(
  p_campaign_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_max_meters double precision default 75
) returns table (voter_id uuid, distance_m double precision)
language sql stable
set search_path = ''
as $$
  -- PostGIS is installed in the public schema on this project; fully
  -- qualify so the pinned empty search_path still resolves the operators.
  select
    v.id,
    public.st_distance(
      v.location,
      public.st_setsrid(public.st_makepoint(p_lng, p_lat), 4326)::public.geography
    ) as distance_m
  from public.voters v
  where v.campaign_id = p_campaign_id
    and v.location is not null
    and public.st_dwithin(
      v.location,
      public.st_setsrid(public.st_makepoint(p_lng, p_lat), 4326)::public.geography,
      p_max_meters
    )
  order by distance_m asc
  limit 1
$$;

-- ---------- 2. Append-only audit_log ----------
-- Migration 1 gave audit_log the generic `for all` tenant policy, which
-- also permits UPDATE and DELETE — a member could rewrite or erase their
-- own trail. Replace it with read + insert only. No UPDATE/DELETE policy
-- exists, so RLS denies both: the log becomes tamper-evident. The worker
-- (service role) still writes freely, bypassing RLS by design.

drop policy if exists tenant_isolation_audit_log on audit_log;

create policy audit_log_select on audit_log
  for select using (campaign_id = current_campaign_id());

create policy audit_log_insert on audit_log
  for insert with check (campaign_id = current_campaign_id());
