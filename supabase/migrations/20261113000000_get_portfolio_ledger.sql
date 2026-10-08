-- ============================================================================
-- get_portfolio_ledger(p_league_id): one-call read for the mobile Portfolio
-- screen (Orchestrator decision D5). Returns, for ONE league, what the screen
-- needs beyond its own position math, so the app stays within a 4-request
-- budget:
--   activity      rows from public.league_activity for the league, oldest first
--   symbol_names  symbol -> name, ONLY for symbols that appear in activity
--                 (a symbol with no row in public.symbols is simply absent)
--   members       {user_id, display_name, is_bot} for CURRENT league members
--
-- PROVISIONAL TIMESTAMP: 20261031000000 is a placeholder chosen to sort after
-- the latest in-tree migration (20261029000000_get_home_league_rpc). Re-stamp
-- at release, keeping it later than every migration applied before then.
--
-- SECURITY -- SECURITY INVOKER, member-scoped by RLS plus one explicit gate.
--   * activity: read through league_activity (security_invoker), so drafts and
--     trades SELECT policies apply as the caller.
--   * symbol_names: read from symbols, whose SELECT policy is USING (true) for
--     PUBLIC (see docs/architecture/db-snapshot.json). The result is limited to
--     the symbols in the caller's own activity. That is payload minimisation,
--     NOT an access boundary: any caller who can SELECT symbols directly already
--     sees every name. The symbols policy is pre-existing and decided (keep).
--   * members: NOT re-implemented. Reuses public.get_league_display_names
--     (20261004000000), filtered to current league_members rows. That function
--     is SECURITY DEFINER and RAISES 42501 for a non-member, so this function
--     gates on public.is_member(p_league_id) FIRST and returns the empty shape
--     for a non-member instead of an error. The empty result and the refusal
--     are different claims; a non-member gets the former, never a silent
--     partial read.
--   * A non-member therefore receives {activity: [], members: [],
--     symbol_names: {}} and no data from any other league.
--
-- GRANTS (CLAUDE.md: REVOKE FROM PUBLIC does not clear Supabase's per-role
-- default EXECUTE grants, so each role is revoked explicitly):
--   revoke all ... from public, anon, service_role;
--   grant execute ... to authenticated;
--   service_role is revoked as well, which goes beyond the requested
--   "from public, anon". Defence in depth: service_role has BYPASSRLS, so the
--   RLS scoping would not apply to it. The is_member gate still returns the
--   empty shape for it (auth.uid() is NULL without a sub claim), so this revoke
--   is not the only barrier. Same lockdown shape as get_home_league
--   (20261029000000).
--
-- STATUS OF THE CLAIM: the grants above are what this migration SETS. They
-- are verified only by the PGlite test (supabase/tests/
-- get_portfolio_ledger.pglite.test.ts), which simulates Supabase's default
-- grants. Prod is verified only by the proacl query below, after the push.
--
-- POST-PUSH EFFECT CHECKS (run each in the SQL editor; never trust push output):
--   1. SELECT proname, proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND proname = 'get_portfolio_ledger';
--      -> expect an authenticated=X entry. The owner's own postgres=X/postgres
--         entry is normal and expected. There must be NO anon=, NO service_role=,
--         and NO leading =X (PUBLIC) entry.
--   2. SELECT proname, prosecdef, proconfig FROM pg_proc
--       WHERE proname = 'get_portfolio_ledger';
--      -> prosecdef = false (INVOKER); proconfig = {search_path=public, pg_temp}.
-- ============================================================================

create or replace function public.get_portfolio_ledger(p_league_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_activity     jsonb;
  v_symbol_names jsonb;
  v_members      jsonb;
begin
  -- Explicit membership gate (see SECURITY above). Without it, the members
  -- read below would raise 42501 for a non-member instead of returning empty.
  if not public.is_member(p_league_id) then
    return jsonb_build_object(
      'activity',     '[]'::jsonb,
      'symbol_names', '{}'::jsonb,
      'members',      '[]'::jsonb);
  end if;

  -- Activity: select from the view, do not re-implement the drafts/trades
  -- union. Explicit column list keeps the payload shape fixed. The tiebreak
  -- keys make the order deterministic when two rows share occurred_at.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'kind',        a.kind,
             'id',          a.id,
             'league_id',   a.league_id,
             'user_id',     a.user_id,
             'symbol',      a.symbol,
             'action',      a.action,
             'quantity',    a.quantity,
             'price',       a.price,
             'total_value', a.total_value,
             'occurred_at', a.occurred_at,
             'round',       a.round,
             'pick_number', a.pick_number)
           order by a.occurred_at, a.kind, a.id
         ), '[]'::jsonb)
    into v_activity
    from public.league_activity a
   where a.league_id = p_league_id;

  -- Names for exactly the symbols the caller's activity mentions.
  select coalesce(jsonb_object_agg(s.symbol, s.name), '{}'::jsonb)
    into v_symbol_names
    from public.symbols s
   where s.symbol in (
           select x.symbol
             from public.league_activity x
            where x.league_id = p_league_id
         );

  -- Current members only. get_league_display_names also names participants
  -- who have LEFT the league (standings, matchups, picks, trades), so the
  -- join to league_members is what restricts this to the roster.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'user_id',      dn.user_id,
             'display_name', dn.display_name,
             'is_bot',       dn.is_bot)
           order by dn.display_name, dn.user_id
         ), '[]'::jsonb)
    into v_members
    from public.get_league_display_names(p_league_id) dn
    join public.league_members m
      on m.league_id = p_league_id
     and m.user_id   = dn.user_id;

  return jsonb_build_object(
    'activity',     v_activity,
    'symbol_names', v_symbol_names,
    'members',      v_members);
end;
$$;

revoke all on function public.get_portfolio_ledger(uuid) from public, anon, service_role;
grant execute on function public.get_portfolio_ledger(uuid) to authenticated;

comment on function public.get_portfolio_ledger(uuid) is
  'Mobile Portfolio screen read model for one league, in one call: '
  '{activity, symbol_names, members}. activity = public.league_activity rows '
  '(drafts + trades) oldest first; symbol_names = symbol -> name for only the '
  'symbols in that activity; members = current league members as '
  '{user_id, display_name, is_bot}. SECURITY INVOKER and member-scoped: RLS on '
  'the underlying tables applies as the caller, and a non-member gets '
  '{activity: [], symbol_names: {}, members: []}, never an error or another '
  'league''s rows. Granted to authenticated only.';
