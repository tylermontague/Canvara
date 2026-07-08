-- ============================================================
-- Canvara Migration 13: Voter Contact Workshop (M12)
-- AI-drafted door-poll questions (neutrality-guardrailed) and
-- conversation sparks (alienation-guardrailed), both requiring
-- leadership approval before a canvasser ever sees them. Spark
-- usage ties each spark to pre/post pairs → per-topic movability.
-- ============================================================

-- Drafted poll questions awaiting review. Approval copies the question
-- into survey_questions; the draft records the guardrail that vetted it.
create table question_drafts (
  id            uuid primary key default uuid_generate_v4(),
  campaign_id   uuid not null references campaigns(id),
  question      text not null,
  options       text[] not null,
  rationale     text,
  evidence      jsonb not null default '{}'::jsonb,
  guardrail     jsonb,                    -- Fable neutrality result
  guardrail_verdict text check (guardrail_verdict in ('pass','flag')),
  status        text not null default 'draft'
                check (status in ('draft','approved','dismissed')),
  model_used    text not null,
  prompt_version text not null,
  created_by    uuid references profiles(id),
  approved_by   uuid references profiles(id),
  approved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index question_drafts_campaign_idx on question_drafts(campaign_id, status);

-- Conversation sparks: canvasser-facing openers designed to create an
-- emotional connection first, persuasion second.
create table sparks (
  id            uuid primary key default uuid_generate_v4(),
  campaign_id   uuid not null references campaigns(id),
  cohort_id     uuid references cohorts(id),   -- null = campaign-wide
  title         text not null,                 -- short label on the field card
  opener        text not null,                 -- what the canvasser says/asks
  why           text,                          -- one-line rationale for the canvasser
  evidence      jsonb not null default '{}'::jsonb,
  guardrail     jsonb,                         -- Fable alienation-rubric result
  guardrail_verdict text check (guardrail_verdict in ('pass','flag')),
  status        text not null default 'draft'
                check (status in ('draft','approved','retired')),
  model_used    text not null,
  prompt_version text not null,
  created_by    uuid references profiles(id),
  approved_by   uuid references profiles(id),
  approved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index sparks_campaign_idx on sparks(campaign_id, status);

-- Which spark(s) the canvasser actually used in a conversation — joined
-- to that conversation's pre/post intention pair for per-spark movement.
create table spark_usages (
  id              uuid primary key default uuid_generate_v4(),
  campaign_id     uuid not null references campaigns(id),
  spark_id        uuid not null references sparks(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (spark_id, conversation_id)             -- idempotent sync
);
create index spark_usages_spark_idx on spark_usages(spark_id);

alter table question_drafts enable row level security;
alter table sparks          enable row level security;
alter table spark_usages    enable row level security;

-- Members see and draft; approval/retirement is a leadership decision
-- (same shape as messages).
do $$
declare t text;
begin
  foreach t in array array['question_drafts','sparks']
  loop
    execute format(
      'create policy %1$s_select on %1$s
         for select using (campaign_id = current_campaign_id())', t);
    execute format(
      'create policy %1$s_insert on %1$s
         for insert with check (campaign_id = current_campaign_id())', t);
    execute format(
      'create policy %1$s_update on %1$s
         for update
         using (campaign_id = current_campaign_id()
                and current_role_in_campaign() in (''admin'',''manager'',''field_director''))
         with check (campaign_id = current_campaign_id())', t);
  end loop;
end $$;

-- Usage rows are written by canvassers' devices — plain tenant isolation.
create policy tenant_isolation_spark_usages on spark_usages
  for all using (campaign_id = current_campaign_id())
  with check (campaign_id = current_campaign_id());
