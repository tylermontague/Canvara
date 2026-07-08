-- ============================================================
-- Canvara Migration 9: district operations map (M8)
-- Campaign events, yard signs, non-canvass contact log, and the
-- map/turnout views the Voter Intelligence dashboard reads.
-- ============================================================

create table campaign_events (
  id           uuid primary key default uuid_generate_v4(),
  campaign_id  uuid not null references campaigns(id),
  kind         text not null check (kind in ('house_meeting','forum','rally','canvass_launch','other')),
  title        text not null,
  location     geography(point, 4326) not null,
  address      text,
  held_at      timestamptz not null,
  notes        text,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now()
);

create table yard_signs (
  id           uuid primary key default uuid_generate_v4(),
  campaign_id  uuid not null references campaigns(id),
  voter_id     uuid references voters(id),
  location     geography(point, 4326) not null,
  address      text,
  placed_at    timestamptz not null default now(),
  placed_by    uuid references profiles(id),
  removed_at   timestamptz,
  created_at   timestamptz not null default now()
);

-- Contacts made through channels other than canvassing (phone, text,
-- mail, email, events). Canvass contacts live in conversations.
create table contact_log (
  id           uuid primary key default uuid_generate_v4(),
  campaign_id  uuid not null references campaigns(id),
  voter_id     uuid not null references voters(id) on delete cascade,
  method       text not null check (method in ('phone','text','mail','email','event','other')),
  contacted_at timestamptz not null default now(),
  source       text,                     -- e.g. 'volunteer phone bank', import name
  created_at   timestamptz not null default now()
);
create index contact_log_voter_idx on contact_log(voter_id);

alter table campaign_events enable row level security;
alter table yard_signs      enable row level security;
alter table contact_log     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['campaign_events','yard_signs','contact_log']
  loop
    execute format(
      'create policy tenant_isolation_%1$s on %1$s
         for all using (campaign_id = current_campaign_id())
         with check (campaign_id = current_campaign_id())', t);
  end loop;
end $$;

-- ---------- Map + turnout views (security_invoker: RLS applies) ----------

create view voter_map_points
with (security_invoker = true) as
select
  id as voter_id,
  campaign_id,
  party,
  st_y(location::geometry) as lat,
  st_x(location::geometry) as lng
from voters
where location is not null;

create view sign_map_points
with (security_invoker = true) as
select
  id as sign_id,
  campaign_id,
  address,
  placed_at,
  st_y(location::geometry) as lat,
  st_x(location::geometry) as lng
from yard_signs
where removed_at is null;

create view event_map_points
with (security_invoker = true) as
select
  id as event_id,
  campaign_id,
  kind,
  title,
  held_at,
  st_y(location::geometry) as lat,
  st_x(location::geometry) as lng
from campaign_events;

-- Turnout per election from voter file vote_history jsonb
-- ({"2024_general": true, ...}). Percentages computed against total
-- registered in code.
create view turnout_by_election
with (security_invoker = true) as
select
  v.campaign_id,
  e.key as election,
  count(*) filter (where e.value = 'true')::int as voted
from voters v,
     jsonb_each_text(coalesce(v.vote_history, '{}'::jsonb)) e
group by v.campaign_id, e.key;
