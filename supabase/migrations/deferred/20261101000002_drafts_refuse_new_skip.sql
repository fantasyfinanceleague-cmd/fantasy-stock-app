-- ============================================================================
-- HELD — DO NOT PUSH UNTIL THE PRECONDITION BELOW IS MET (CLAUDE.md: a header
-- holds nothing; only deferred/ does).
--
-- Structural guard for "a draft pick can never be unused" (2026-10-05): refuse
-- any NEW drafts row whose symbol is SKIP, on INSERT and on an UPDATE of symbol.
-- After this, the SKIP sentinel can be written by nothing, not even a future edge
-- function. (Defence in depth: SKIP is already unwritable from every client path —
-- the drafts insert policies are dropped by 20260811000003 — and validatePick
-- refuses the symbol.)
--
-- Existing SKIP rows are untouched: turn math, the fixed_notional unfilled-slot
-- credit (draft-validation.ts fixedNotionalFunding) and the ownership/budget
-- exclusions still read legacy rows. The new BEFORE INSERT trigger only refuses
-- inserts; it never rewrites history.
--
-- PRECONDITION (promote to supabase/migrations/ only when ALL hold):
--   1. 20261101000000 (draft_feasibility_pool) and 20261101000001 (draft_stalls)
--      are applied, verified by supabase_migrations.schema_migrations;
--   2. validate-and-record-pick, draft-control and draft-autopick-sweep from the
--      draft-never-skips build are deployed AND byte-verified (CLAUDE.md:
--      the upload list includes _shared/draft-feasibility.ts, then a scratch
--      `supabase functions download` diffed against the commit). The OLD deployed
--      code still writes SKIP on its skip paths and would start failing with a
--      500 under this trigger, so this must follow the deploy, never precede it;
--   3. the auto-pick sweep cron (deferred/20261010000001) is promoted with 1.2.0
--      (stall recovery for bots relies on it — see deferred/README.md);
--   4. a grep of the repo finds no remaining SKIP writer, and web's
--      apps/web/src/pages/DraftPage.jsx skipTurn (action 'skip') is either removed
--      or accepted as a silent no-op (it now receives skip_disabled).
--
-- HUMAN ACTION: move to supabase/migrations/ and supabase db push (Giorgio's).
-- Effect-verify: a plain insert with symbol 'SKIP' is refused (check_violation);
-- an existing SKIP row is still readable.
-- ============================================================================

create or replace function public.refuse_new_skip_rows()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if upper(new.symbol) = 'SKIP' then
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
