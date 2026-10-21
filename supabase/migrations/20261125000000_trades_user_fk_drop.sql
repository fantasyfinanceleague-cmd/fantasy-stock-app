-- ============================================================================
-- Account deletion (1/9): trades.user_id stops cascading from auth.users
-- ============================================================================
-- Plan: docs/plans/2026-10-21-account-deletion.md, §"The system's side",
-- "Identity model". Giorgio, 2026-10-21: the team outlives the account ("A plus
-- C ... we delete the account asap").
--
-- trades.user_id is the ONLY league column with a real foreign key to
-- auth.users, and it is ON DELETE CASCADE (20250118000000_create_trades.sql).
-- Deleting a manager's auth row would silently delete their whole trade history
-- and leave every past week of their league un-auditable for everyone else in
-- it (positions, cash, scores are all derived from drafts + trades). Every other
-- league table already holds the user id as an opaque key with no FK
-- (league_members, matchups, league_standings, week_snapshots, drafts,
-- league_draft_order, league_seasons), so this brings trades in line.
--
-- The column stays uuid NOT NULL as it is; only the constraint goes. The FK is
-- found by catalog lookup (any FK on trades(user_id) referencing auth.users),
-- not by name, so a prod name that differs from the default
-- trades_user_id_fkey cannot leave it in place. The DO block then asserts none
-- remains. A re-run finds nothing and is a no-op.
--
-- Nothing else references auth.users from a league table:
-- trades.funded_by_trade_id is trades -> trades (NO ACTION) and unaffected;
-- user_profiles and push_tokens keep their ON DELETE CASCADE on purpose (they
-- are the account's private rows, scrubbed with it).
--
-- PROVISIONAL TIMESTAMP: 20261125000000-07 are re-stamped at release after
-- prod's latest applied version; re-stamp only unapplied files (CLAUDE.md).
--
-- POST-PUSH CHECK (SQL editor):
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.trades'::regclass AND contype = 'f'
--      AND confrelid = 'auth.users'::regclass;
--   -- EXPECT 0 rows.
--   Effect: docs/security/account-deletion-effect-test.sql (read-only).
-- ============================================================================

do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.trades'::regclass
       and c.contype = 'f'
       and c.confrelid = 'auth.users'::regclass
  loop
    execute format('alter table public.trades drop constraint %I', r.conname);
  end loop;

  if exists (select 1 from pg_constraint c
              where c.conrelid = 'public.trades'::regclass
                and c.contype = 'f'
                and c.confrelid = 'auth.users'::regclass) then
    raise exception 'trades still references auth.users after the drop';
  end if;
end;
$$;

comment on column public.trades.user_id is
  'Account deletion (20261125000000): an opaque user id with NO foreign key, like every other league table. '
  'A deleted manager''s trades stay, so their league''s past weeks stay auditable.';
