-- Promoted from deferred/ on 2026-10-06 as 20261106000002 (was 20261101000002),
-- re-stamped later than prod's latest applied migration. The trigger is unchanged
-- from the held version; the function gained two hardenings found in review:
--   * the match is on upper(btrim(symbol, whitespace)), so a padded ' SKIP' or
--     'SKIP<tab>' is refused too;
--   * an UPDATE that leaves symbol UNCHANGED passes, because UPDATE OF symbol fires
--     for any statement that merely names the column. Without this, a blanket
--     `update drafts set symbol = upper(symbol)` would abort on the first legacy
--     SKIP row, which this trigger promises never to touch.
--
-- Structural guard for "a draft pick can never be unused" (2026-10-05): refuse
-- any NEW drafts row whose symbol is SKIP, on INSERT and on an UPDATE of symbol.
-- After this, the SKIP sentinel can be written by nothing, not even a future edge
-- function. (Defence in depth: SKIP is already unwritable from every client path,
-- since the drafts insert policies are dropped by 20260811000003, and validatePick
-- refuses the symbol.)
--
-- Existing SKIP rows are untouched: turn math, the fixed_notional unfilled-slot
-- credit (draft-validation.ts fixedNotionalFunding) and the ownership/budget
-- exclusions still read legacy rows. The BEFORE INSERT/UPDATE-OF-symbol trigger only
-- refuses writes; it never rewrites history, and an UPDATE of any other column on a
-- legacy SKIP row is not intercepted.
--
-- PRECONDITIONS (all verified before promotion; docs/migrations/AUTOPICK_CRON_LIVE.md):
--   1. 20261101000000 (draft_feasibility_pool) and 20261101000001 (draft_stalls) are
--      applied (schema_migrations; applied 2026-10-06);
--   2. validate-and-record-pick, draft-control and draft-autopick-sweep from the
--      draft-never-skips build are deployed AND byte-verified (b5499bb). The OLD
--      code wrote SKIP on its skip paths and would 500 under this trigger;
--   3. the auto-pick sweep cron is promoted IN THIS RELEASE (20261106000000), since
--      stall recovery for bots relies on it;
--   4. no remaining SKIP writer: grep finds none in supabase/functions, scripts or
--      apps; web's DraftPage skipTurn sends action 'skip', which the live function
--      refuses with skip_disabled before any insert, so it is a silent no-op.
--
-- Effect check (HUMAN ACTION, in the runbook): an INSERT of SKIP is refused with
-- check_violation (23514); an existing SKIP row is still readable.
-- ============================================================================

create or replace function public.refuse_new_skip_rows()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.symbol is not distinct from old.symbol then
    return new;
  end if;
  if upper(btrim(new.symbol, E' \t\r\n')) = 'SKIP' then
    raise exception 'SKIP rows are retired: a draft pick can never be unused (draft-never-skips, 2026-10-05)'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.refuse_new_skip_rows() from public;
revoke all on function public.refuse_new_skip_rows() from anon, authenticated;

drop trigger if exists drafts_refuse_new_skip on public.drafts;
create trigger drafts_refuse_new_skip
  before insert or update of symbol on public.drafts
  for each row execute function public.refuse_new_skip_rows();
