-- ============================================================
-- Canvara Migration 15: voter data portal (M14)
-- Re-importing a voter file MERGES — it never replaces. File columns
-- are updated by the file; everything the field learned (door-observed
-- attributes, beliefs, signals, personal context, geocodes) lives on
-- separate rows and is left untouched. This migration adds the
-- provenance + lifecycle columns the merge needs.
-- ============================================================

-- Import history / provenance. Each run records what it did so a merge
-- is auditable and previewable.
create table imports (
  id             uuid primary key default uuid_generate_v4(),
  campaign_id    uuid not null references campaigns(id),
  source_label   text not null,               -- e.g. 'county file 2026-07', 'phone match'
  filename       text,
  row_count      int not null default 0,      -- data rows in the file
  inserted_count int not null default 0,
  updated_count  int not null default 0,
  unchanged_count int not null default 0,
  dropped_count  int not null default 0,      -- voters marked inactive (absent from file)
  reactivated_count int not null default 0,
  unmergeable_count int not null default 0,   -- rows with no external_id to key on
  mapping        jsonb not null default '{}'::jsonb,
  created_by     uuid references profiles(id),
  created_at     timestamptz not null default now()
);
create index imports_campaign_idx on imports(campaign_id, created_at desc);

alter table imports enable row level security;
create policy tenant_isolation_imports on imports
  for all using (campaign_id = current_campaign_id())
  with check (campaign_id = current_campaign_id());

-- Voter lifecycle + provenance.
--  active: false when a voter drops out of the latest file (moved / purged).
--    We never delete them — they carry canvass history — but they leave
--    the working universe (map, and later the counts).
--  dropped_from_file_at: when they last fell out of a file.
--  last_import_id: which import last saw this voter in-file.
alter table voters add column if not exists active boolean not null default true;
alter table voters add column if not exists dropped_from_file_at timestamptz;
alter table voters add column if not exists last_import_id uuid references imports(id);

-- The merge key. Partial (external_id is nullable; manually-created voters
-- without a file ID are never merge-matched).
create unique index if not exists voters_campaign_external_uidx
  on voters(campaign_id, external_id)
  where external_id is not null;

-- The district map shows the working universe only — drop inactive voters.
create or replace view voter_map_points
with (security_invoker = true) as
select
  id as voter_id,
  campaign_id,
  party,
  st_y(location::geometry) as lat,
  st_x(location::geometry) as lng
from voters
where location is not null
  and active;
