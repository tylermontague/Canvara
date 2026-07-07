# External polling sources for cohort priors

Canvara's belief engine seeds voter-issue priors from external polling
(`belief_states.source = 'polling_prior'`, stored per cohort in
`cohort_issue_priors`). This is the source list we standardize on as a
business. Ingestion tooling lands in Phase 2; until then priors are entered
manually per campaign.

**The precedence rule, always:** priors describe cohorts; conversations
describe people. Individual evidence from canvassing overrides any prior.

## National issue polling (free, methodologically gold-standard)

| Source | Use for | Notes |
|---|---|---|
| Pew Research Center | Issue salience + positions by demographic cohort | Crosstabs published; the default prior source. `issues.pew_gallup_mapping` exists for alignment |
| Gallup | Long-run issue trends ("most important problem") | Best time-series baselines |
| AP-NORC | Issue priorities, government trust | Strong methodology, frequent releases |
| PRRI | Religion × politics crosstabs | Key for the religiosity dimension |
| KFF | Healthcare issues | Definitive on health policy opinion |
| ANES / CES (Cooperative Election Study) | Deep academic crosstabs, validated voters | Large-N; CES has state-level cuts; updated post-election |

## Election / horse-race context

| Source | Use for | Notes |
|---|---|---|
| NYT/Siena, Marist, Monmouth, Quinnipiac | High-quality state/national election polling | A-rated pollsters; use for ceiling-of-persuasion context |
| Split Ticket / Silver Bulletin aggregates | Weighted averages | Never rely on a single poll |

## State & local (pilot: Arizona)

| Source | Use for | Notes |
|---|---|---|
| OH Predictive Insights | AZ statewide issue + race polling | Most prolific AZ pollster |
| Noble Predictive Insights | AZ/Southwest | AZ crosstabs incl. Latino subsamples |
| ASU Morrison Institute | AZ policy issue surveys | Slower cadence, deep on water/growth |

## Working rules

1. Record `source` and `as_of` on every prior — stale priors decay in
   credibility just like beliefs do.
2. Match cohort definitions to the pollster's actual crosstab breaks (the
   `COHORT_DIMENSIONS` in `packages/shared` mirror the standard breaks for
   this reason).
3. Licensing: Pew/Gallup-topline and academic data are citable; some state
   pollsters require subscription for crosstabs — budget for one AZ
   subscription at pilot.
4. When a campaign's own door polls (survey_questions) reach sufficient n
   for a cohort, they supersede external priors for that cohort — our own
   first-party data is closer to the electorate we're actually contacting.
