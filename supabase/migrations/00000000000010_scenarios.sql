-- ============================================================
-- Canvara Migration 10: what-if scenarios (M9)
-- Saved electorate scenarios and manually entered external poll
-- priors per segment ("how are we doing" beside our door data).
-- ============================================================

-- A saved strategy: one dimension's segments with turnout / our-share
-- assumptions (packages/shared/scenarios.ts ScenarioAssumptions shape).
create table scenarios (
  id           uuid primary key default uuid_generate_v4(),
  campaign_id  uuid not null references campaigns(id),
  name         text not null,
  dimension    text not null,             -- 'age_bracket' | 'gender' | ... | 'precinct' | 'zip'
  assumptions  jsonb not null,            -- {dimension, segments: [...], expectedElectorate}
  notes        text,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index scenarios_campaign_idx on scenarios(campaign_id);

-- Manual external poll numbers per segment (docs/polling-sources.md).
-- One current prior per campaign/dimension/segment; updating replaces it.
create table poll_priors (
  id            uuid primary key default uuid_generate_v4(),
  campaign_id   uuid not null references campaigns(id),
  dimension     text not null,
  segment       text not null,            -- canonical segment key, e.g. '65_plus'
  our_share_pct numeric not null check (our_share_pct >= 0 and our_share_pct <= 100),
  source        text not null,            -- e.g. 'ABC/WaPo 2026-06'
  as_of         date,
  created_by    uuid references profiles(id),
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (campaign_id, dimension, segment)
);

alter table scenarios   enable row level security;
alter table poll_priors enable row level security;

do $$
declare t text;
begin
  foreach t in array array['scenarios','poll_priors']
  loop
    execute format(
      'create policy tenant_isolation_%1$s on %1$s
         for all using (campaign_id = current_campaign_id())
         with check (campaign_id = current_campaign_id())', t);
  end loop;
end $$;
