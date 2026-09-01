-- In-house simulator (DR-001 / SIMULATOR_MIGRATION_SPEC Phase 2)
-- Companion to 20260810000002_leagues_add_stake_mode.sql (adds the stake_mode
-- column + one-time data migration). This file adds the ONGOING mirror.
--
-- WHY: `budget_mode` is still written by 5 live client sites (mobile
--   leagues/create-league/league-settings, web useLeagues/Leagues) and none of
--   them writes `stake_mode` yet. Without this trigger, every league created or
--   edited AFTER the push would land with `stake_mode` NULL — reintroducing the
--   exact unmapped state that 000002's one-time UPDATE was meant to eliminate.
--
-- WHAT: a BEFORE INSERT/UPDATE trigger on `leagues` that mirrors `budget_mode`
--   into `stake_mode`, using the same mapping as 000002:
--     'budget'    -> 'budget_cap'
--     'no-budget' -> NULL   (intended "commissioner re-choice pending" state,
--                            NOT the unmapped-gap problem — the gap was 'budget'
--                            leagues landing NULL, which this fixes)
--   It fires on INSERT (always) and on UPDATE only when `budget_mode` actually
--   changes, so an unrelated UPDATE never clobbers stake_mode.
--
-- INTERIM — REMOVAL IS COUPLED TO THE CLIENT SWITCH: `stake_mode` is the
--   authoritative field; this trigger only exists because clients still write
--   the deprecated `budget_mode`. When clients are switched to write `stake_mode`
--   directly (later phase), they will (for a transition window) still send the
--   legacy `budget_mode='budget'`, which this trigger would map back over an
--   explicit stake_mode. Therefore DROP this trigger + function in the SAME
--   migration that lands the client switch. Until then it is load-bearing.
--
-- search_path pinned per repo convention. db push is HUMAN ACTION.

create or replace function public.mirror_budget_mode_to_stake_mode()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.budget_mode is distinct from old.budget_mode then
    new.stake_mode := case new.budget_mode
                        when 'budget'    then 'budget_cap'
                        when 'no-budget' then null
                        else new.stake_mode  -- unknown legacy value: leave as-is
                      end;
  end if;
  return new;
end;
$$;

drop trigger if exists leagues_mirror_budget_mode on leagues;
create trigger leagues_mirror_budget_mode
  before insert or update of budget_mode on leagues
  for each row execute function public.mirror_budget_mode_to_stake_mode();

-- Effect-verify AFTER push (do not trust push output):
--   INSERT a 'budget' league via a legacy path, then:
--     SELECT budget_mode, stake_mode FROM leagues WHERE id = '<new id>';
--   -- must show budget_mode='budget', stake_mode='budget_cap'.
