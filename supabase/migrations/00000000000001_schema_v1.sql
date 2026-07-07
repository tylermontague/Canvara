-- ============================================================
-- Canvara Schema v1  (Supabase / Postgres)
-- Multi-tenant from day one. Every domain table carries
-- campaign_id and is protected by Row Level Security.
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists postgis;  -- GPS correlation (IE-3)

-- ---------- Tenancy & identity ----------

create table campaigns (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  state       text not null,                  -- e.g. 'AZ'
  consent_mode text not null default 'one_party'
              check (consent_mode in ('one_party','two_party')),  -- ADR-6 / CX-1
  retention_days int not null default 730,    -- CX-2
  created_at  timestamptz not null default now()
);

-- Maps Supabase auth users into a campaign with a role.
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  campaign_id uuid not null references campaigns(id),
  role        text not null check (role in
              ('admin','manager','field_director','organizer','canvasser')),
  full_name   text,
  created_at  timestamptz not null default now()
);

-- Helper: current user's campaign (used by every RLS policy)
create or replace function current_campaign_id() returns uuid
language sql stable security definer as $$
  select campaign_id from profiles where id = auth.uid()
$$;

create or replace function current_role_in_campaign() returns text
language sql stable security definer as $$
  select role from profiles where id = auth.uid()
$$;

-- ---------- Voter file ----------

create table voters (
  id            uuid primary key default uuid_generate_v4(),
  campaign_id   uuid not null references campaigns(id),
  external_id   text,                          -- voter file ID
  first_name    text, last_name text,
  address       text, city text, zip text,
  precinct      text,
  party         text,
  birth_year    int,
  gender        text,
  vote_history  jsonb default '{}'::jsonb,     -- {"2024_general": true, ...}
  location      geography(point, 4326),        -- for GPS correlation
  created_at    timestamptz not null default now()
);
create index voters_campaign_idx on voters(campaign_id);
create index voters_location_idx on voters using gist(location);
create index voters_precinct_idx on voters(campaign_id, precinct);

-- ---------- Issue taxonomy (shared reference, ~60–80 leaf nodes) ----------

create table issues (
  id        text primary key,                  -- slug: 'property_taxes'
  parent_id text references issues(id),
  label     text not null,
  pew_gallup_mapping text                      -- external category mapping
);

-- ---------- Field operations ----------

create table walk_lists (
  id           uuid primary key default uuid_generate_v4(),
  campaign_id  uuid not null references campaigns(id),
  name         text not null,
  assigned_to  uuid references profiles(id),   -- canvasser
  created_at   timestamptz not null default now()
);

create table walk_list_items (
  id           uuid primary key default uuid_generate_v4(),
  campaign_id  uuid not null references campaigns(id),
  walk_list_id uuid not null references walk_lists(id) on delete cascade,
  voter_id     uuid not null references voters(id),
  position     int not null,
  status       text not null default 'pending'
               check (status in ('pending','visited','not_home','skipped','rescheduled'))
);
create index wli_list_idx on walk_list_items(walk_list_id, position);

create table shifts (
  id           uuid primary key default uuid_generate_v4(),
  campaign_id  uuid not null references campaigns(id),
  canvasser_id uuid not null references profiles(id),
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);

-- ---------- Conversations & pipeline ----------

create table conversations (
  id             uuid primary key default uuid_generate_v4(),
  campaign_id    uuid not null references campaigns(id),
  shift_id       uuid references shifts(id),
  canvasser_id   uuid not null references profiles(id),
  voter_id       uuid references voters(id),        -- null until correlated
  voter_id_manual boolean not null default false,   -- canvasser override wins (IE-3)
  audio_path     text,                              -- Supabase Storage path
  recorded_at    timestamptz not null,
  gps            geography(point, 4326),
  consent_disclosed_at timestamptz,                 -- ADR-6 disclosure log
  contact_result text check (contact_result in
                 ('answered','not_home','refused','brief_exchange','full_conversation')),
  status         text not null default 'captured' check (status in
                 ('captured','uploaded','transcribing','transcribed',
                  'extracting','extracted','review','complete','failed')),
  transcript     jsonb,      -- diarized: [{speaker, text, ts}]
  wer_estimate   numeric,
  created_at     timestamptz not null default now()
);
create index conv_campaign_idx on conversations(campaign_id, status);
create index conv_voter_idx on conversations(voter_id);

-- SignalObject: the 11-field Ambient Polling taxonomy (Learn contract)
create table signals (
  id              uuid primary key default uuid_generate_v4(),
  campaign_id     uuid not null references campaigns(id),
  conversation_id uuid not null unique references conversations(id) on delete cascade,
  support_level   text check (support_level in
                  ('strong_support','lean_support','undecided',
                   'lean_oppose','strong_oppose','unknown')),
  top_issues      text[] default '{}',              -- ordered, unprompted salience
  issue_sentiment jsonb default '{}'::jsonb,        -- {"schools":"positive",...}
  emotional_valence text check (emotional_valence in
                  ('enthusiastic','positive','neutral','frustrated','hostile')),
  persuadability  text check (persuadability in
                  ('locked_in','leaning','persuadable','disengaged')),
  information_gaps text[] default '{}',
  message_resonance jsonb default '[]'::jsonb,      -- [{message, response}]
  follow_up_signals text[] default '{}',
  provenance      jsonb default '{}'::jsonb,        -- spontaneous vs prompted per issue
  confidence_score numeric not null check (confidence_score between 0 and 1),
  model_used      text not null,                    -- 'claude-haiku-4-5' etc.
  prompt_version  text not null,
  canvasser_confirmed boolean default false,        -- FA-5 debrief
  corrections     jsonb default '[]'::jsonb,        -- training data (IE-8)
  created_at      timestamptz not null default now()
);
create index signals_campaign_idx on signals(campaign_id);

-- Bayesian belief states (IE-5): Beta(alpha, beta) per voter per issue
create table belief_states (
  campaign_id  uuid not null references campaigns(id),
  voter_id     uuid not null references voters(id) on delete cascade,
  issue_id     text not null references issues(id),
  alpha        numeric not null default 1,
  beta         numeric not null default 1,
  source       text not null default 'polling_prior'
               check (source in ('polling_prior','first_party','blended')),
  last_observed_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (voter_id, issue_id)
);
create index beliefs_campaign_idx on belief_states(campaign_id);

create table review_queue (
  id              uuid primary key default uuid_generate_v4(),
  campaign_id     uuid not null references campaigns(id),
  conversation_id uuid not null references conversations(id),
  reason          text not null,           -- 'low_confidence' | 'audit_sample' | 'unmatched_voter'
  status          text not null default 'open' check (status in ('open','resolved')),
  resolved_by     uuid references profiles(id),
  resolution      jsonb,
  created_at      timestamptz not null default now()
);

create table audit_log (
  id          bigint generated always as identity primary key,
  campaign_id uuid not null references campaigns(id),
  actor_id    uuid references profiles(id),
  action      text not null,
  entity      text not null,
  entity_id   uuid,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

-- ---------- Row Level Security (the firewall) ----------

alter table campaigns        enable row level security;
alter table profiles         enable row level security;
alter table voters           enable row level security;
alter table walk_lists       enable row level security;
alter table walk_list_items  enable row level security;
alter table shifts           enable row level security;
alter table conversations    enable row level security;
alter table signals          enable row level security;
alter table belief_states    enable row level security;
alter table review_queue     enable row level security;
alter table audit_log        enable row level security;

-- Campaign visibility: users see only their own campaign row
create policy campaign_isolation on campaigns
  for select using (id = current_campaign_id());

create policy profile_self on profiles
  for select using (campaign_id = current_campaign_id());

-- Generic tenant isolation policy applied to every domain table
do $$
declare t text;
begin
  foreach t in array array['voters','walk_lists','walk_list_items','shifts',
                           'conversations','signals','belief_states',
                           'review_queue','audit_log']
  loop
    execute format(
      'create policy tenant_isolation_%1$s on %1$s
         for all using (campaign_id = current_campaign_id())
         with check (campaign_id = current_campaign_id())', t);
  end loop;
end $$;

-- Canvasser narrowing: canvassers see only their assigned work (FA-1)
create policy canvasser_own_shifts on shifts
  for select using (
    campaign_id = current_campaign_id()
    and (current_role_in_campaign() <> 'canvasser' or canvasser_id = auth.uid())
  );

-- issues is a shared reference table: readable by all authenticated users
alter table issues enable row level security;
create policy issues_read on issues for select using (auth.uid() is not null);

-- Worker service uses the service_role key and bypasses RLS by design;
-- it must always set campaign_id explicitly and never join across tenants.

-- ---------- Storage ----------
-- Bucket: 'conversations' — path convention: {campaign_id}/{conversation_id}.m4a
-- Storage policy mirrors tenant isolation on the path prefix.
