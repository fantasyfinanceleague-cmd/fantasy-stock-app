-- ============================================================================
-- Participant display names (Phase 3 backend ask #2)
-- ============================================================================
-- PROBLEM
--   Matchup/standings/draft reads show real opponents as "Opponent --" (no
--   username lookup on the client for a non-uuid id) or a truncated id
--   ("test-use…"), and bots always render as "Bot N" from a client-side
--   string check — never persisted, never readable server-side, and not
--   available to any future server-rendered surface (web dashboard, ask #1).
--
--   Participant ids are mixed across this schema: real users are uuid
--   strings (user_profiles.id is uuid); bots are `bot-N`, or `bot-N-k` when
--   nextBotIds (supabase/functions/draft-control/rules.ts) resolves a
--   collision between a web-added and a server-added bot; seeded/simulation
--   test participants look like `test-user-2` (see apps/mobile/lib/uuid.ts —
--   neither bot-prefixed nor a valid uuid).
--
-- DESIGN
--   Two functions:
--     * participant_display_name(text) — pure, INTERNAL naming logic. Not
--       reachable by any client role (see grants) so it can never be used
--       as a per-id profile oracle ("does this id have a username?" answered
--       one id at a time). Only get_league_display_names calls it.
--     * get_league_display_names(uuid) — the actual entry point. Returns a
--       name for every id that has EVER participated in the league (member
--       row, standings row, a matchup slot, a draft pick, or a trade), not
--       just current members — a participant who left still shows up in
--       standings/matchups/draft/trade history and would otherwise render
--       with no name at all. Restricted to callers who are themselves a
--       member (see SECURITY below); a non-member is refused, not handed an
--       empty set,
--       so "not allowed" can't be misread as "no participants" (CLAUDE.md
--       verdict-scope lesson: an empty result and a refusal are different
--       claims and must not collapse into each other).
--
--   Bot naming: a curated, APPEND-ONLY list indexed by the bot's number,
--   because bot-N's position in the array IS bot-N's identity — reordering
--   would rename every existing bot in every league. The name is a pure
--   function of the id (no storage, no backfill, no edge-function change,
--   no user-controlled text to moderate), so it's stable across seasons,
--   reads and clients. `-k` collision suffixes append " k+1" (bot-1-1 =>
--   "Ticker Tina 2"), and bot numbers beyond the list wrap with a numeric
--   suffix rather than raising or returning NULL.
--
--   *** APPEND-ONLY: do not reorder, rename, or remove list entries. ***
--   Names reviewed for tone/brand-safety by Design Lead 2026-10-04.
--
-- SECURITY
--   Both functions are SECURITY DEFINER with search_path pinned to
--   (public, pg_temp) — no relative-schema lookup, per CLAUDE.md.
--   get_league_display_names derives membership from auth.uid(), never a
--   parameter: a NULL auth.uid() (anon, or a definer call with no JWT) is
--   refused before touching the league at all, and an authenticated caller
--   who isn't a member of p_league_id is refused too (RAISE, not a filtered
--   empty result — see DESIGN above).
--
--   This does NOT widen user_profiles exposure: `authenticated` already has
--   USING (true) SELECT on the whole table (20260728000001); the client-
--   visible surface here is (user_id, display_name, is_bot) for co-members
--   only, i.e. narrower than what a client can already read directly.
--
--   Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on every new function
--   to anon/authenticated/service_role; REVOKE FROM PUBLIC does not touch
--   those. Both functions get an explicit REVOKE from PUBLIC, anon,
--   authenticated AND service_role. get_league_display_names is then
--   explicitly re-granted to authenticated only; participant_display_name is
--   granted to NOBODY (service_role included — nothing calls it directly;
--   the two entry points reach it via their own definer-owner privilege, not
--   via the caller's grant, so this revoke doesn't affect them) — verify
--   with the proacl query below, never assume the revoke closed it.
--
-- ---------------------------------------------------------------------------
-- POST-PUSH EFFECT CHECKS (run each separately):
--   -- 1. grants: get_league_display_names -> authenticated (+ postgres) only,
--   --    no service_role=; participant_display_name -> NEITHER anon NOR
--   --    authenticated NOR service_role NOR PUBLIC
--   SELECT proname, proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname IN ('get_league_display_names','participant_display_name');
--   -- 2. search_path pinned on both: expect {search_path=public, pg_temp}
--   SELECT proname, proconfig FROM pg_proc
--   WHERE proname IN ('get_league_display_names','participant_display_name');
--   -- 3. call-time check (belt-and-suspenders vs. #1): as anon, expect 42501
--   --    (do NOT run as postgres/service_role in the SQL editor — that role
--   --    bypasses grants and would falsely "pass")
-- ============================================================================

create or replace function public.participant_display_name(p_user_id text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  -- APPEND-ONLY. Index N (1-based) names bot-N. Never reorder/rename/remove.
  v_bot_names constant text[] := array[
    'Ticker Tina', 'Earnings Ed', 'Dividend Dee', 'Blue Chip Bo',
    'Index Ivy', 'Growth Gus', 'Bull Run Bea', 'Bearish Bart',
    'Chart Cal', 'Volume Val', 'Rally Ray', 'Yield Yara',
    'Split Sid', 'Sector Sam', 'Momentum Max', 'Gains Gia'
  ];
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_bot_re  constant text := '^bot-([0-9]+)(?:-([0-9]+))?$';
  v_m       text[];
  v_n       int;
  v_suffix  int;
  v_base    text;
  v_username text;
begin
  if p_user_id is null then
    return null;
  end if;

  -- Bot ids: bot-N or bot-N-k (nextBotIds collision suffix). The numeric
  -- capture is attacker-shaped text in principle (it flows from whatever is
  -- stored in league_members/matchups/drafts, not from a caller-supplied
  -- parameter — but this helper is a shared single point of failure for two
  -- client-facing RPCs, so an oversized or non-1-based capture degrades to
  -- the generic label below rather than raising and aborting the whole
  -- caller's result set for one bad id.
  v_m := regexp_match(p_user_id, v_bot_re, 'i');
  if v_m is not null then
    begin
      v_n := v_m[1]::int;
      if v_n < 1 then
        raise exception 'non-positive bot number';
      end if;
      v_base := v_bot_names[((v_n - 1) % array_length(v_bot_names, 1)) + 1];
      if v_n > array_length(v_bot_names, 1) then
        v_base := v_base || ' ' || v_n::text;
      end if;
      if v_m[2] is not null then
        v_suffix := v_m[2]::int;
        v_base := v_base || ' ' || (v_suffix + 1)::text;
      end if;
      return v_base;
    exception when others then
      return initcap(replace(p_user_id, '-', ' '));
    end;
  end if;

  -- Real users: uuid-shaped ids only reach the profile lookup, matching
  -- apps/mobile/lib/uuid.ts's isUuid guard so a non-uuid id never reaches a
  -- ::uuid cast (the #36 22P02 lesson applies to this function's own body,
  -- not just to the client's .in() batching).
  if p_user_id ~* v_uuid_re then
    select username into v_username from user_profiles where id = p_user_id::uuid;
    if v_username is not null and length(trim(v_username)) > 0 then
      return v_username;
    end if;
    return 'Player ' || upper(left(p_user_id, 4));
  end if;

  -- Anything else (seeded/simulation test participants like "test-user-2"):
  -- a readable label, never a raw id fragment.
  return initcap(replace(p_user_id, '-', ' '));
end;
$$;

revoke all on function public.participant_display_name(text) from public;
revoke all on function public.participant_display_name(text) from anon;
revoke all on function public.participant_display_name(text) from authenticated;
revoke all on function public.participant_display_name(text) from service_role;
-- Deliberately no GRANT to any role, including service_role — internal
-- helper only, reached exclusively by get_league_display_names and
-- get_home_summary running as the function OWNER (definer-owner privilege),
-- never by an invoker's own grant. A missing grant here cannot break either
-- caller.

create or replace function public.get_league_display_names(p_league_id uuid)
returns table(user_id text, display_name text, is_bot boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller text := auth.uid()::text;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- Reuses is_member (20260712000000) rather than re-inlining the same
  -- predicate, so "what counts as a member" stays defined in exactly one
  -- place. is_member reads auth.uid() itself; v_caller is still needed below
  -- to null-check auth.uid() first (is_member alone can't distinguish
  -- "not authenticated" from "authenticated, not a member", and those get
  -- different messages here for the same 42501).
  if not public.is_member(p_league_id) then
    raise exception 'not a league member' using errcode = '42501';
  end if;

  return query
  with participant_ids as (
    select m.user_id from league_members m where m.league_id = p_league_id
    union
    select s.user_id from league_standings s where s.league_id = p_league_id
    union
    select mu.team1_user_id from matchups mu where mu.league_id = p_league_id and mu.team1_user_id is not null
    union
    select mu.team2_user_id from matchups mu where mu.league_id = p_league_id and mu.team2_user_id is not null
    union
    select d.user_id::text from drafts d where d.league_id = p_league_id
    union
    -- trades.user_id is uuid (drafts.user_id is text) — CLAUDE.md: cross-table
    -- position queries need explicit casts. In today's write paths a trades
    -- row implies an earlier drafts row for the same user (both gated by
    -- league-membership RLS, and a user can't trade before drafting/joining),
    -- so this is very likely already a subset of the drafts branch above —
    -- but "every id that has EVER participated" is this function's own
    -- stated completeness claim, and CLAUDE.md is explicit that a
    -- completeness claim must not rest on an unstated subset. Included
    -- directly rather than documented as "safe to omit".
    select t.user_id::text from trades t where t.league_id = p_league_id
  )
  select
    p.user_id,
    public.participant_display_name(p.user_id),
    p.user_id ~* '^bot-[0-9]+(-[0-9]+)?$'
  from participant_ids p
  where p.user_id is not null;
end;
$$;

revoke all on function public.get_league_display_names(uuid) from public;
revoke all on function public.get_league_display_names(uuid) from anon;
revoke all on function public.get_league_display_names(uuid) from authenticated;
revoke all on function public.get_league_display_names(uuid) from service_role;
grant execute on function public.get_league_display_names(uuid) to authenticated;
-- service_role is revoked, not re-granted: nothing calls this via
-- service_role today (edge functions read these tables directly, already
-- bypassing RLS as service_role) — the grant surface is kept to exactly the
-- one intended caller, authenticated (the mobile/web client).
