-- ============================================================
-- Canvara Migration 7: persuasion foundations (M6.5)
-- Standard-pollster demographics, door-observed voter attributes,
-- door polls, cohort blocks, and external polling priors.
-- Principle encoded downstream: what a voter says in a conversation
-- always trumps what their cohort membership would predict.
-- ============================================================

-- Demographics carried by professional voter files (modeled values).
alter table voters add column if not exists race text;
alter table voters add column if not exists income_bracket text;
alter table voters add column if not exists education text;
alter table voters add column if not exists religion text;

-- Attributes learned at the door or extracted from conversations —
-- the file says one thing, the human interaction may say better.
create table voter_attributes (
  id           uuid primary key default uuid_generate_v4(),
  campaign_id  uuid not null references campaigns(id),
  voter_id     uuid not null references voters(id) on delete cascade,
  key          text not null,            -- 'race' | 'religiosity' | 'language' | 'education' | ...
  value        text not null,
  source       text not null check (source in ('file','canvasser','extracted')),
  noted_by     uuid references profiles(id),
  conversation_id uuid references conversations(id),
  created_at   timestamptz not null default now(),
  unique (voter_id, key)                 -- latest observation wins (upsert)
);
create index voter_attrs_voter_idx on voter_attributes(voter_id);

-- Door polls (structured survey questions, MODULE_MAP intelligence stream).
create table survey_questions (
  id           uuid primary key default uuid_generate_v4(),
  campaign_id  uuid not null references campaigns(id),
  question     text not null,
  options      text[] not null,          -- fixed-choice at the door
  active       boolean not null default true,
  position     int not null default 0,
  created_at   timestamptz not null default now()
);

create table survey_responses (
  id              uuid primary key default uuid_generate_v4(),
  campaign_id     uuid not null references campaigns(id),
  question_id     uuid not null references survey_questions(id),
  conversation_id uuid not null references conversations(id) on delete cascade,
  voter_id        uuid references voters(id),
  answer          text not null,
  created_at      timestamptz not null default now(),
  unique (question_id, conversation_id)  -- idempotent sync
);
create index survey_responses_q_idx on survey_responses(question_id);

-- Cohort blocks: named voter groupings by standard demographics and/or
-- stance on a defining issue. Definitions are jsonb evaluated in code
-- (packages/shared/cohorts.ts) so the console, tests, and future Message
-- Lab share one evaluator.
create table cohorts (
  id           uuid primary key default uuid_generate_v4(),
  campaign_id  uuid not null references campaigns(id),
  name         text not null,
  definition   jsonb not null,           -- {demographics: {...}, issue_stances: [...]}
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now()
);

-- External polling priors per cohort per issue (Pew/Gallup/etc.).
-- Ingestion tooling lands in Phase 2; the slot exists now so the belief
-- engine's 'polling_prior' source has a home.
create table cohort_issue_priors (
  id           uuid primary key default uuid_generate_v4(),
  campaign_id  uuid not null references campaigns(id),
  cohort_id    uuid not null references cohorts(id) on delete cascade,
  issue_id     text not null references issues(id),
  stance       jsonb not null,           -- {positive: 0.31, negative: 0.52, ...}
  source       text not null,            -- e.g. 'pew-2026-03'
  as_of        date not null,
  created_at   timestamptz not null default now(),
  unique (cohort_id, issue_id, source, as_of)
);

-- Tenant isolation on everything new.
alter table voter_attributes    enable row level security;
alter table survey_questions    enable row level security;
alter table survey_responses    enable row level security;
alter table cohorts             enable row level security;
alter table cohort_issue_priors enable row level security;

do $$
declare t text;
begin
  foreach t in array array['voter_attributes','survey_questions',
                           'survey_responses','cohorts','cohort_issue_priors']
  loop
    execute format(
      'create policy tenant_isolation_%1$s on %1$s
         for all using (campaign_id = current_campaign_id())
         with check (campaign_id = current_campaign_id())', t);
  end loop;
end $$;

-- Personal connection context extracted from conversations (FA-5 → CC-5).
-- Lives on the signal so it SURVIVES retention purges of raw transcripts.
alter table signals add column if not exists personal_context text[] default '{}';
