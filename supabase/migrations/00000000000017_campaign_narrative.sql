-- ============================================================
-- Canvara Migration 17: campaign narrative (M15)
-- The candidate's persona — story, values, voice, biographical
-- proof points — authored once and injected into every generated
-- message and canvass spark so all voter contact sings from one
-- songbook. One record per campaign.
-- ============================================================

create table campaign_narrative (
  id               uuid primary key default uuid_generate_v4(),
  campaign_id      uuid not null unique references campaigns(id),
  candidate_name   text,
  pitch            text,                 -- one-line elevator pitch
  story            text,                 -- the backstory / ethos, freeform
  values           text[] not null default '{}',   -- core values
  signature_issues text[] not null default '{}',   -- the issues they own
  proof_points     text[] not null default '{}',   -- biographical hooks
  tone             text,                 -- voice descriptor, e.g. 'warm, plainspoken'
  updated_by       uuid references profiles(id),
  updated_at       timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

alter table campaign_narrative enable row level security;

-- Every campaign member can read the narrative (it grounds their work)...
create policy campaign_narrative_select on campaign_narrative
  for select using (campaign_id = current_campaign_id());

-- ...but authoring it is a leadership decision.
create policy campaign_narrative_write on campaign_narrative
  for all
  using (
    campaign_id = current_campaign_id()
    and current_role_in_campaign() in ('admin', 'manager', 'field_director')
  )
  with check (
    campaign_id = current_campaign_id()
    and current_role_in_campaign() in ('admin', 'manager', 'field_director')
  );
