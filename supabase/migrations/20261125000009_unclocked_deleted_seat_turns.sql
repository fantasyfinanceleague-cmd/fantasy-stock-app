-- ============================================================================
-- Account deletion (10/10): the unclocked drafts a deleted seat could stall
-- ============================================================================
-- Plan: docs/plans/2026-10-21-account-deletion.md, decision 16 (#305): "The
-- sweep auto-picks for a deleted seat as soon as it is that seat's turn, even
-- when pick_clock_enabled = false", from Giorgio's standing rule "there can
-- never be an instance where a player doesn't get a pick".
--
-- Today an unclocked draft is never auto-picked: overdue_draft_turns
-- (20261010000000) requires pick_clock_enabled, and the edge gate
-- (_shared/auto-pick.ts decideAutoPickGate) refuses 'clock_not_running'. A seat
-- whose manager deleted their account mid-draft would therefore stall such a
-- draft forever (takeover opens only once the draft is complete, decision 14).
--
-- THE SPLIT (agreed with the Orchestrator, 2026-10-21):
--   SQL (this file): unclocked_deleted_seat_turns() -> (league_id, pick_number),
--     every in_progress draft with pick_clock_enabled = false that has at least
--     one deleted seat (league_members.deleted_at IS NOT NULL), with the pick
--     that is due next. pick_number is get_draft_clock's own picks_made + 1, so
--     it can never drift from overdue_draft_turns' numbering.
--   EDGE (W3): the sweep also iterates these rows, computes the picker for
--     pick_number from the draft order (the snake lives in TS), and auto-picks
--     ONLY when that picker's seat is deleted. Clocked drafts are unchanged.
--   get_draft_clock is NOT changed: it is authenticated-callable and drives the
--   room's clock, and it does not know the picker, so a faked deadline there
--   would be wrong for everyone else's turns.
--
-- This lists CANDIDATE leagues, not a verdict that a deleted seat is on the
-- clock: most turns in such a draft belong to live managers, and the edge must
-- check the picker before it acts (CLAUDE.md, verdict scope).
--
-- SERVICE ROLE ONLY, read-only, SECURITY DEFINER, search_path pinned.
--
-- PROVISIONAL TIMESTAMP: see 20261125000000.
--
-- POST-PUSH CHECK (SQL editor):
--   SELECT proacl, prosecdef, proconfig FROM pg_proc WHERE proname = 'unclocked_deleted_seat_turns';
--   -- {postgres=X/postgres,service_role=X/postgres}, t, {"search_path=public, pg_temp"}
-- ============================================================================

create or replace function public.unclocked_deleted_seat_turns()
returns table (league_id uuid, pick_number integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.id, c.picks_made + 1
    from public.leagues l
   cross join lateral public.get_draft_clock(l.id) c
   where l.draft_status = 'in_progress'
     and not l.pick_clock_enabled
     and exists (select 1 from public.league_members m
                  where m.league_id = l.id and m.deleted_at is not null)
   order by l.id;
$$;

comment on function public.unclocked_deleted_seat_turns() is
  'Account deletion decision 16 (2026-10-21): unclocked in-progress drafts holding a deleted seat, with the next '
  'pick number. Candidates only: the sweep auto-picks only if that pick''s picker is the deleted seat. Service role only.';

revoke all on function public.unclocked_deleted_seat_turns() from public, anon, authenticated;
grant execute on function public.unclocked_deleted_seat_turns() to service_role;
