-- ============================================================
-- Canvara Migration 6: pilot hardening (M6)
-- Issue taxonomy seed, campaign settings policy, pipeline health view.
-- ============================================================

-- Issue taxonomy v1 (generated from packages/shared/src/issues.ts — keep
-- in sync). Parents ordered before children; idempotent.
insert into issues (id, parent_id, label) values
  ('economy', null, 'Economy'),
  ('cost_of_living', 'economy', 'Cost of living'),
  ('property_taxes', 'economy', 'Property taxes'),
  ('taxes', 'economy', 'Taxes (general)'),
  ('housing', 'economy', 'Housing & affordability'),
  ('jobs', 'economy', 'Jobs & wages'),
  ('small_business', 'economy', 'Small business'),
  ('infrastructure', null, 'Infrastructure'),
  ('roads', 'infrastructure', 'Roads & traffic'),
  ('transit', 'infrastructure', 'Public transit'),
  ('water', 'infrastructure', 'Water'),
  ('utilities', 'infrastructure', 'Utilities & energy'),
  ('development', 'infrastructure', 'Growth & development'),
  ('education', null, 'Education'),
  ('schools', 'education', 'Public schools'),
  ('school_funding', 'education', 'School funding'),
  ('higher_education', 'education', 'Higher education'),
  ('public_safety', null, 'Public safety'),
  ('crime', 'public_safety', 'Crime'),
  ('policing', 'public_safety', 'Policing'),
  ('border_security', 'public_safety', 'Border security'),
  ('drugs', 'public_safety', 'Drugs & opioids'),
  ('healthcare', null, 'Healthcare'),
  ('abortion', 'healthcare', 'Abortion & reproductive rights'),
  ('seniors', null, 'Seniors & retirement'),
  ('environment', null, 'Environment'),
  ('climate', 'environment', 'Climate'),
  ('government_trust', null, 'Trust in government'),
  ('elections', null, 'Elections & voting'),
  ('immigration', null, 'Immigration'),
  ('veterans', null, 'Veterans'),
  ('homelessness', null, 'Homelessness')
on conflict (id) do update set parent_id = excluded.parent_id, label = excluded.label;

-- Admins and managers may edit their own campaign's settings (CX-2:
-- retention_days, consent_mode).
create policy campaign_admin_update on campaigns
  for update
  using (
    id = current_campaign_id()
    and current_role_in_campaign() in ('admin', 'manager')
  )
  with check (id = current_campaign_id());

-- Pipeline health (monitoring): conversation counts by status.
create view pipeline_health
with (security_invoker = true) as
select
  campaign_id,
  status,
  count(*)::int as n,
  max(created_at) as newest,
  min(created_at) filter (where status in ('uploaded', 'transcribing', 'transcribed', 'extracting')) as oldest_in_flight
from conversations
group by campaign_id, status;
