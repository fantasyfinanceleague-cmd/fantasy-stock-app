-- get_visible_profiles: the ONLY path to another player's profile (audit #8).
--
-- Giorgio, 2026-10-08 (ruling A, verbatim): "i can only see other names and
-- avatars of other users im in a leauge with. we cannot allow a user to see any
-- information outside of the name/avatar of another member in their league
-- (email, etc) or any info about users not in their league."
--
-- THIS MIGRATION IS ADDITIVE (stage 1 of 2). It only adds the narrow read path;
-- user_profiles' "Authenticated users can view profiles" USING (true) policy is
-- untouched, so nothing breaks while clients move over. The policy flip to
-- SELF ONLY is stage 2, held in supabase/migrations/deferred/
-- 20261118000001_user_profiles_self_only.sql until the clients that read other
-- players' rows directly (including the live 1.1.0 build) are gone.
--
-- CONTRACT
--   get_visible_profiles(p_user_ids text[]) -> (id uuid, username text, avatar text)
--   * One row per requested id that is VISIBLE to the caller and has a profile:
--       - the caller's own id; or
--       - any user who has EVER participated in a league the caller is CURRENTLY
--         a member of -- league_members, league_standings, matchups (either
--         side), drafts, trades. "Ever participated" is the same set
--         get_league_display_names (20261004000000) names, so a player who LEFT
--         a league stays named in that league's standings, history and matchups.
--   * Exactly three columns, by construction: id (for joins), username,
--     avatar. Never created_at, notifications_enabled, or a column added later
--     -- the select list is explicit, not p.*.
--   * Anything not visible is simply absent (not an error), exactly like an
--     RLS-filtered .in('id', ...) read, so callers keep their existing
--     "no profile -> fallback label" handling.
--   * Non-uuid ids (bots 'bot-N', seeded test ids) are ignored before any
--     ::uuid cast (the #36 22P02 lesson). At most 500 ids per call (22023).
--   * Not signed in -> 42501. EXECUTE: authenticated only.
--
-- WHY A BY-ID FUNCTION (not extending get_league_display_names): every client
-- read it replaces is shaped .from('user_profiles').select('id, username[,
-- avatar]').in('id', ids), and web's UserProfilesContext caches profiles across
-- ALL the user's leagues, not one league. A by-id function is a drop-in for
-- that shape. get_league_display_names stays exactly as it is -- the live
-- 1.1.0 app calls it, so changing its return type (DROP + CREATE) is a risk
-- with no benefit.
--
-- SECURITY DEFINER with search_path pinned; owner postgres reads user_profiles
-- past RLS, so the visibility rule here IS the boundary (and is tested in
-- supabase/tests/profile_visibility.pglite.test.ts).
--
-- POST-PUSH CHECKS (SQL editor; each on its own):
--   SELECT proname, prosecdef, proconfig, proacl FROM pg_proc WHERE proname = 'get_visible_profiles';
--   -- EXPECT prosecdef t, proconfig {"search_path=public, pg_temp"},
--   --        proacl postgres + authenticated ONLY (no anon, no service_role, no '=X').
--   -- Effect, in the app: names and (web) avatars still show everywhere; this
--   -- migration alone changes nothing visible.

create or replace function public.get_visible_profiles(p_user_ids text[])
returns table (id uuid, username text, avatar text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'get_visible_profiles: not authenticated' using errcode = '42501';
  end if;
  if p_user_ids is null or cardinality(p_user_ids) = 0 then
    return;
  end if;
  if cardinality(p_user_ids) > 500 then
    raise exception 'get_visible_profiles: at most 500 ids (got %)', cardinality(p_user_ids)
      using errcode = '22023';
  end if;

  return query
  with wanted as (
    select distinct lower(x) as uid
      from unnest(p_user_ids) as x
     where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  my_leagues as (
    select m.league_id from public.league_members m where m.user_id = v_caller::text
  ),
  -- Everyone who has EVER participated in one of the caller's current leagues,
  -- restricted up front to the requested ids. Cross-table casts per CLAUDE.md
  -- (drafts/league_members/matchups ids are text, trades.user_id is uuid).
  visible as (
    select v_caller::text as uid
    union
    select m.user_id from public.league_members m join my_leagues l on l.league_id = m.league_id
    union
    select s.user_id from public.league_standings s join my_leagues l on l.league_id = s.league_id
    union
    select mu.team1_user_id from public.matchups mu join my_leagues l on l.league_id = mu.league_id
    union
    select mu.team2_user_id from public.matchups mu join my_leagues l on l.league_id = mu.league_id
    union
    select d.user_id::text from public.drafts d join my_leagues l on l.league_id = d.league_id
    union
    select t.user_id::text from public.trades t join my_leagues l on l.league_id = t.league_id
  )
  select p.id, p.username, p.avatar
    from public.user_profiles p
    join wanted w on w.uid = p.id::text
   where p.id::text in (select lower(v.uid) from visible v where v.uid is not null);
end;
$$;

comment on function public.get_visible_profiles(text[]) is
  'Audit #8 (2026-10-08): id, username, avatar for the caller and for users who have ever '
  'participated in a league the caller is a current member of. Nothing else, nobody else.';

revoke all on function public.get_visible_profiles(text[]) from public, anon, authenticated, service_role;
grant execute on function public.get_visible_profiles(text[]) to authenticated;
