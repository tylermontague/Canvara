-- ============================================================
-- Canvara Migration 5: Ambient Pulse aggregates (CC-1/CC-2 tier 1)
-- security_invoker views: callers see only rows their RLS allows, so
-- every aggregate is automatically campaign-fenced.
-- ============================================================

-- Support distribution across all extracted signals.
create view pulse_support_distribution
with (security_invoker = true) as
select
  s.campaign_id,
  s.support_level,
  count(*)::int as n
from signals s
where s.support_level is not null
group by s.campaign_id, s.support_level;

-- Issue salience: mention counts, spontaneous share (the ambient-polling
-- core), and sentiment split per issue.
create view pulse_issue_salience
with (security_invoker = true) as
select
  s.campaign_id,
  issue,
  count(*)::int as mentions,
  count(*) filter (where s.provenance ->> issue = 'spontaneous')::int as spontaneous,
  count(*) filter (where s.issue_sentiment ->> issue = 'negative')::int as negative,
  count(*) filter (where s.issue_sentiment ->> issue = 'positive')::int as positive,
  count(*) filter (where s.issue_sentiment ->> issue in ('mixed', 'neutral'))::int as neutral_mixed
from signals s
cross join lateral unnest(s.top_issues) as issue
group by s.campaign_id, issue;

-- Daily trend by conversation recorded time (UTC days).
create view pulse_daily_trend
with (security_invoker = true) as
select
  c.campaign_id,
  (date_trunc('day', c.recorded_at))::date as day,
  s.support_level,
  count(*)::int as n
from signals s
join conversations c on c.id = s.conversation_id
where s.support_level is not null
group by c.campaign_id, day, s.support_level;
