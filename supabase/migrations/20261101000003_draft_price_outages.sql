-- ============================================================================
-- Vendor-outage handling for the draft auto-pick (draft-never-skips, 2026-10-05,
-- review residual 1 / Orchestrator decision (a)). Internal tables, service role only.
--
-- auto_pick_price_failures: a per-LEAGUE, per-symbol NEGATIVE CACHE. A symbol whose live price
--   failed is skipped for PRICE_COOLDOWN_MS (5 min) so the walk moves to the next
--   legal candidate instead of retrying the same dead symbol.
-- draft_turn_outages: the clock of a turn stopped only by vendor outages. Past
--   OUTAGE_ESCALATE_MS it is escalated once (draft_stalls reason 'vendor_outage').
--
-- Effect-verify after push (HUMAN ACTION):
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname IN
--     ('auto_pick_price_failures','draft_turn_outages');   -- both true
--   SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name IN ('auto_pick_price_failures','draft_turn_outages');
--   -- expect service_role only; NOTHING for anon or authenticated
--
-- DEPLOY ORDER (review finding 5): this migration MUST be applied before the
-- functions that call it are deployed. Without the tables, coolingSymbols throws on
-- every walk and every auto-pick stops (fail-closed, but a blackout).
--
-- HUMAN ACTION: supabase db push, from the deploy checkout only (CLAUDE.md).
-- ============================================================================

create table if not exists public.auto_pick_price_failures (
  league_id  uuid not null references public.leagues(id) on delete cascade,
  symbol     text not null,
  failed_at  timestamptz not null default now(),
  primary key (league_id, symbol)
);

create table if not exists public.draft_turn_outages (
  league_id     uuid not null references public.leagues(id) on delete cascade,
  pick_number   integer not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  escalated_at  timestamptz,
  primary key (league_id, pick_number)
);

-- RLS on with NO policies: anon and authenticated are denied; service role bypasses.
alter table public.auto_pick_price_failures enable row level security;
alter table public.draft_turn_outages enable row level security;

revoke all on public.auto_pick_price_failures from anon, authenticated;
revoke all on public.draft_turn_outages from anon, authenticated;
grant all on public.auto_pick_price_failures to service_role;
grant all on public.draft_turn_outages to service_role;
