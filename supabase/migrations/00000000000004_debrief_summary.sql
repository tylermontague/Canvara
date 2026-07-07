-- ============================================================
-- Canvara Migration 4: canvasser debrief (FA-5)
-- The worker writes a short plain-language summary alongside each
-- extracted signal; the field app shows it for tappable confirm/correct.
-- ============================================================

alter table signals add column if not exists debrief_summary text;
