-- ============================================================================
-- Backfill: give every auth.users account a user_profiles row (ask #6
-- follow-up, docs/design/prompts/phase3-plan.md).
--
-- WHY: handle_new_user_profile (20261005000001) only fires on a NEW
-- auth.users INSERT. Accounts created BEFORE it went live predate the fix
-- entirely — their signup-time client-side upsert was refused by RLS (the
-- #6 root cause: signUp() returns no session under email confirmation, so
-- that upsert runs as anon and auth.uid() = id fails) with no retry, so they
-- have NO user_profiles ROW AT ALL, not merely a NULL username. Prod
-- (2026-09-27): 4 auth.users rows, only 2 user_profiles rows.
--
-- This is a DIFFERENT gap than the trigger's own NULL-on-collision path (an
-- invalid-format or collided username still gets a ROW, just with
-- username = NULL). Both end up NULL, for different reasons, and that's
-- fine: after this backfill, EVERY account has exactly one profile row, and
-- `username IS NULL` alone is enough to drive the 3b-1 first-run "pick a
-- username" prompt — it never needs to distinguish "row missing" from "row
-- present but empty".
--
-- IDEMPOTENT: `ON CONFLICT (id) DO NOTHING` only inserts where no row exists
-- yet, so re-running this migration (or a future one covering the same
-- accounts) is always a no-op the second time. Safe to run at any point,
-- including after handle_new_user_profile has already handled every NEW
-- signup — this only ever touches accounts already missing a row.
-- ============================================================================
insert into public.user_profiles (id, username)
select u.id, null
  from auth.users u
  left join public.user_profiles p on p.id = u.id
 where p.id is null
on conflict (id) do nothing;

-- ============================================================================
-- HUMAN ACTION (Giorgio) — verify AFTER db push (not push output):
--   SELECT count(*) FROM auth.users u
--    LEFT JOIN public.user_profiles p ON p.id = u.id
--   WHERE p.id IS NULL;
--   -> must return 0. Every account now has a profile row (username may
--      still be NULL, which is expected and drives the 3b-1 prompt).
-- ============================================================================
