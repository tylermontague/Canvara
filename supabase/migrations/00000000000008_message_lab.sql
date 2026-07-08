-- ============================================================
-- Canvara Migration 8: Message Lab v1 (CC-5)
-- Messages are hypotheses tested against evidence. Every draft records
-- the evidence that shaped it and the guardrail verdict that vetted it.
-- ============================================================

create table messages (
  id            uuid primary key default uuid_generate_v4(),
  campaign_id   uuid not null references campaigns(id),
  kind          text not null check (kind in ('cohort','individual')),
  cohort_id     uuid references cohorts(id),
  voter_id      uuid references voters(id),
  issue_id      text references issues(id),
  goal          text not null check (goal in ('persuade','turnout','introduce')),
  title         text not null,
  body          text not null,
  rationale     text,                     -- why the model believes this lands
  evidence      jsonb not null default '{}'::jsonb,  -- what informed the draft
  guardrail     jsonb,                    -- full Fable guardrail result
  guardrail_verdict text check (guardrail_verdict in ('pass','flag')),
  status        text not null default 'draft'
                check (status in ('draft','approved','rejected')),
  model_used    text not null,
  prompt_version text not null,
  created_by    uuid references profiles(id),
  approved_by   uuid references profiles(id),
  approved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index messages_campaign_idx on messages(campaign_id, status);
create index messages_voter_idx on messages(voter_id);

alter table messages enable row level security;

-- Campaign members can see and draft messages...
create policy messages_select on messages
  for select using (campaign_id = current_campaign_id());
create policy messages_insert on messages
  for insert with check (campaign_id = current_campaign_id());

-- ...but approval/rejection is a leadership decision.
create policy messages_update on messages
  for update
  using (
    campaign_id = current_campaign_id()
    and current_role_in_campaign() in ('admin','manager','field_director')
  )
  with check (campaign_id = current_campaign_id());
