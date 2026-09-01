-- In-house simulator (DR-001 / SIMULATOR_MIGRATION_SPEC Phase 2)
-- Binding consequence #3 (simulator-recon.md, Phase 0.5).
--
-- ============================================================================
-- REVIEW BEFORE APPLY — HELD IN deferred/, NOT in the `supabase db push` path.
-- ============================================================================
-- WHAT: make `drafts.league_id` NOT NULL. It is currently NULLABLE (Phase 0.5),
--   which is surprising for a league-scoped table and lets orphan picks exist
--   that no league RLS predicate or server validator can reason about.
--
-- WHY DEFERRED: this migration is GATED on there being ZERO NULL rows, and that
--   gate raises an exception if the gate fails. If applied inside the normal
--   push batch while NULL rows exist, it would abort the WHOLE batch. It is held
--   in deferred/ so Giorgio applies it deliberately, after inspecting/backfilling
--   NULL rows — not as a side effect of an unrelated push.
--
-- APPLY PROCEDURE (Giorgio, HUMAN ACTION):
--   1. Inspect the orphans:
--        SELECT id, user_id, symbol, draft_date
--          FROM drafts WHERE league_id IS NULL;
--   2. BACKFILL each orphan's league_id from whatever source recovers it (draft
--      session, trades in the same window, or delete if genuinely junk). There
--      is NO in-repo derivation for league_id, so backfill is a human judgement
--      call — a placeholder UPDATE is intentionally left commented below rather
--      than guessed.
--   3. Only when step 1 returns zero rows, `git mv` this file to
--      supabase/migrations/ and `supabase db push`. The DO block below is a
--      belt-and-suspenders guard: it re-checks and ABORTS if any NULL remains,
--      so the SET NOT NULL can never run against dirty data.
--   4. Effect-verify:
--        SELECT is_nullable FROM information_schema.columns
--         WHERE table_name='drafts' AND column_name='league_id';  -- must be 'NO'

-- Step 2 backfill (author-provided source required — example shape only):
-- UPDATE drafts d SET league_id = <recovered_league_id> WHERE d.id = '<orphan id>';

-- Gate: refuse to proceed while any orphan remains.
do $$
declare
  null_count integer;
begin
  select count(*) into null_count from drafts where league_id is null;
  if null_count > 0 then
    raise exception
      'ABORT drafts.league_id SET NOT NULL: % row(s) still have NULL league_id. Backfill them first (see APPLY PROCEDURE). This migration is a no-op guard until zero NULL rows remain.',
      null_count;
  end if;
end $$;

alter table drafts alter column league_id set not null;
