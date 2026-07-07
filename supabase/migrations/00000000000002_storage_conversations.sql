-- ============================================================
-- Canvara Migration 2: conversations storage bucket + policies
-- Path convention: {campaign_id}/{conversation_id}.m4a  (schema v1 §Storage)
-- Storage mirrors tenant isolation on the first path segment.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('conversations', 'conversations', false)
on conflict (id) do nothing;

-- Canvassers (any authenticated campaign member) may upload recordings
-- into their own campaign's folder only.
create policy conversations_audio_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'conversations'
    and (storage.foldername(name))[1] = current_campaign_id()::text
  );

-- Campaign members may read their own campaign's recordings (console
-- transcript/audio playback in later milestones).
create policy conversations_audio_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'conversations'
    and (storage.foldername(name))[1] = current_campaign_id()::text
  );

-- No update/delete policies: recordings are immutable from the field.
-- The worker (service role) bypasses RLS for pipeline reads.

-- Voter coordinates in a client-consumable shape (PostGIS geography is
-- opaque WKB over the API). security_invoker: callers see only rows their
-- RLS on voters allows.
create view voter_coords
with (security_invoker = true) as
  select
    id as voter_id,
    campaign_id,
    st_y(location::geometry) as lat,
    st_x(location::geometry) as lng
  from voters
  where location is not null;
