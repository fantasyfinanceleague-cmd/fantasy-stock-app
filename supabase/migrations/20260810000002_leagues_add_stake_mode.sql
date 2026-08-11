-- In-house simulator (DR-001 / SIMULATOR_MIGRATION_SPEC Phase 2)
-- Binding consequence #5 (simulator-recon.md, Phase 0.5). Stake-mode
-- reconciliation — do NOT create a parallel budget concept (spec line 51:
-- "Never let both fields be authoritative simultaneously").
--
-- WHAT:
--   1. add `stake_mode` text NULLABLE, checked to (fixed_notional | price_tiers
--      | budget_cap) or NULL. NULL is a real state: "commissioner re-choice
--      pending" (the migrated 'no-budget' leagues, which map to no stake mode).
--   2. add `notional_per_slot` numeric NOT NULL default 1000 — the per-slot
--      simulated stake for fixed_notional mode (DR-001 default $1,000/slot).
--   3. DATA MIGRATION: budget_mode='budget' -> stake_mode='budget_cap' (its
--      existing budget_amount is retained as the cap). budget_mode='no-budget'
--      -> stake_mode LEFT NULL, pending commissioner re-choice.
--   4. deprecate `budget_mode` via COMMENT (kept until app reads migrate; a
--      later cleanup migration drops it — spec line 51). stake_mode is the sole
--      authoritative field from here.
--
-- NOT TOUCHED — `salary_cap_limit`: git grep shows it is LIVE, not dead. It is
--   written by 5 client sites (mobile leagues/create-league/league-settings,
--   web useLeagues/Leagues) and read as a budget fallback in
--   apps/web/src/pages/DraftPage.jsx:179 (`budget_amount ?? salary_cap_limit`).
--   Binding consequence #5 says "deprecate only if dead" — it is not dead, so it
--   is left entirely alone here. Reconciling salary_cap_limit vs budget_amount is
--   a separate follow-up, out of scope for Phase 2.
--
-- SAFETY: stake_mode / notional_per_slot are confirmed ABSENT in Phase 0.5;
--   `if not exists` guards each ADD. The UPDATE is idempotent (only fills rows
--   whose stake_mode is still NULL). budget_amount is NOT rewritten — it already
--   holds the cap value for budget leagues.
--
-- HUMAN ACTION: `supabase db push` is Giorgio's. Effect-verify with:
--   SELECT budget_mode, stake_mode, count(*) FROM leagues GROUP BY 1,2;
--   -- 'budget' rows must show stake_mode='budget_cap'; 'no-budget' rows NULL.

alter table leagues
  add column if not exists stake_mode text
    check (stake_mode is null or stake_mode in ('fixed_notional','price_tiers','budget_cap'));

alter table leagues
  add column if not exists notional_per_slot numeric not null default 1000;

-- Data migration: existing budget leagues become budget_cap; budget_amount is
-- already the cap value, so no value rewrite. 'no-budget' leagues are left with
-- stake_mode NULL on purpose (commissioner re-choice pending).
update leagues
   set stake_mode = 'budget_cap'
 where budget_mode = 'budget'
   and stake_mode is null;

comment on column leagues.budget_mode is
  'DEPRECATED — superseded by stake_mode (fixed_notional|price_tiers|budget_cap). Retained only until app reads migrate; dropped in a later cleanup migration. Do NOT treat as authoritative alongside stake_mode.';
comment on column leagues.budget_amount is
  'Doubles as the budget cap when stake_mode = budget_cap (retained from the pre-stake_mode budget model).';
comment on column leagues.notional_per_slot is
  'Per-slot simulated stake for stake_mode = fixed_notional (DR-001 default $1,000/slot).';
