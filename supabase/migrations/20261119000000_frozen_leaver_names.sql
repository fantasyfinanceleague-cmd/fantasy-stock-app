-- ============================================================================
-- Frozen leaver names (1/2): the snapshot, the league-aware resolver, and
-- get_visible_profiles
-- ============================================================================
-- Giorgio, 2026-10-11, board #call-leaver-names, "A with frozen names": a
-- manager who LEFT a league stays named (name + avatar) in the seasons they
-- played with you, frozen as they were when they left. A rename or avatar
-- change after they leave must NOT reach their former leaguemates. No "Former
-- manager" label, no visual marker.
--
-- WHO IS A LEAVER. Leaving AFTER the season keeps the membership and sets
-- league_members.hidden_at (leave_league, 20261110000001). Leaving before the
-- draft DELETES the row, and such a player has no standings, matchups, drafts
-- or trades, so they never appear in a season. So "a leaver who appears in a
-- past season" is exactly: a league_members row with hidden_at IS NOT NULL.
-- hidden_at is the ONLY discriminator. The frozen columns can be NULL for a
-- real leaver (a profile with no username, or no avatar), so nothing here or
-- downstream may test frozen_username IS NULL to mean "not a leaver"
-- (CLAUDE.md, "Overloaded NULLs are type tags").
--
-- WHAT THIS FILE DOES
--   1. league_members gains frozen_username, frozen_avatar and frozen_at.
--      frozen_at says WHEN the snapshot was taken (it is not the leaver test):
--      the trigger sets it to the moment hidden_at was set; the backfill below
--      sets it to the moment this migration ran.
--   2. trg_league_members_freeze_leaver (BEFORE INSERT OR UPDATE OF hidden_at,
--      frozen_username, frozen_avatar, frozen_at):
--        hidden_at NULL -> NOT NULL  copy the user's CURRENT user_profiles
--                                    username + avatar, frozen_at = now();
--        hidden_at -> NULL           clear all three (unhide_league: they are a
--                                    current member again, so they are live);
--        stays NOT NULL              keep the existing snapshot (a write to the
--                                    frozen columns is ignored, so no one can
--                                    rewrite a leaver's frozen name);
--        stays NULL                  the frozen columns stay NULL.
--      INSERT is covered too, so a row cannot be born with a forged snapshot
--      (league_members_insert_self lets a commissioner insert their own row).
--      Updates of other columns (role, joined_at) do not fire it at all.
--   3. Backfill: every row that is ALREADY hidden gets the user's profile AS
--      OF THIS MIGRATION. That is the best available: the profile at the time
--      they left was never recorded, so a leaver who renamed between leaving
--      and this push is frozen under the newer name. Re-applying this file does
--      not re-snapshot (it only fills rows with frozen_at IS NULL).
--   4. league_participant_display_name(p_league_id, p_user_id): the frozen name
--      when that user's row in that league is hidden, with the SAME fallback
--      participant_display_name uses for a missing username ('Player XXXX');
--      otherwise participant_display_name(p_user_id) unchanged. Bots and
--      non-uuid test ids always go to participant_display_name (their name is a
--      pure function of the id, so there is nothing to freeze).
--      20261119000001 switches the callers.
--   5. get_visible_profiles: 20261118000000's body plus ONE change. For a
--      requested id (other than the caller) that has a hidden row in one of the
--      caller's leagues and NO non-hidden row in any of them, it returns the
--      frozen username/avatar of the most recent such hidden_at. If they still
--      share at least one league with the caller where they are not hidden, the
--      live profile, as before. The caller's own id is always live. Same return
--      shape, guards and grant.
--
-- SECURITY. Both new functions are SECURITY DEFINER with search_path pinned
-- (they read user_profiles, which is self-only for clients since
-- 20261118000001), and both are revoked from PUBLIC, anon, authenticated and
-- service_role with no re-grant: a trigger function is not callable directly,
-- and the resolver is internal like participant_display_name (reached only by
-- definer callers as owner). league_members_select_members lets a member read
-- their leaguemates' rows, frozen columns included: that is a leaguemate's
-- name and avatar, exactly what PRODUCT_RULES "Who can see other players"
-- allows.
--
-- POST-PUSH CHECKS (SQL editor, each on its own):
--   SELECT proname, prosecdef, proconfig, proacl FROM pg_proc
--    WHERE proname IN ('league_members_freeze_leaver', 'league_participant_display_name', 'get_visible_profiles');
--   -- EXPECT prosecdef t and {"search_path=public, pg_temp"} on all three;
--   --   the first two proacl {postgres=X/postgres} ONLY; get_visible_profiles
--   --   {postgres=X/postgres,authenticated=X/postgres}.
--   SELECT count(*) FILTER (WHERE frozen_at IS NULL) AS unfrozen, count(*) AS hidden
--     FROM public.league_members WHERE hidden_at IS NOT NULL;
--   -- EXPECT unfrozen = 0.
--   Effect: docs/security/frozen-leaver-names-effect-test.sql (rolls back).
-- ============================================================================

alter table public.league_members
  add column if not exists frozen_username text,
  add column if not exists frozen_avatar   text,
  add column if not exists frozen_at       timestamptz;

comment on column public.league_members.frozen_username is
  'Frozen leaver names (20261119000000): the user''s username when hidden_at was set. Meaningful ONLY when hidden_at IS NOT NULL; NULL is a legitimate frozen value (no username). Never test it to mean "not a leaver" -- hidden_at is the discriminator.';
comment on column public.league_members.frozen_avatar is
  'Frozen leaver names (20261119000000): the user''s avatar when hidden_at was set. Same rules as frozen_username.';
comment on column public.league_members.frozen_at is
  'Frozen leaver names (20261119000000): when the snapshot was taken (the hide, or this migration''s backfill for rows hidden before it). NULL while hidden_at IS NULL.';

-- ---- 2a. the snapshot function ----------------------------------------------
create or replace function public.league_members_freeze_leaver()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.hidden_at is null then
    -- Not hidden (a current member, or unhidden again): nothing frozen.
    new.frozen_username := null;
    new.frozen_avatar   := null;
    new.frozen_at       := null;
  elsif tg_op = 'INSERT' or old.hidden_at is null then
    -- The moment they leave: their profile as it is NOW.
    new.frozen_username := null;
    new.frozen_avatar   := null;
    -- uuid-shaped ids only reach the ::uuid cast (the #36 22P02 lesson).
    if new.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select p.username, p.avatar into new.frozen_username, new.frozen_avatar
        from public.user_profiles p where p.id = new.user_id::uuid;
    end if;
    new.frozen_at := now();
  else
    -- Still hidden: the snapshot is fixed.
    new.frozen_username := old.frozen_username;
    new.frozen_avatar   := old.frozen_avatar;
    new.frozen_at       := old.frozen_at;
  end if;
  return new;
end;
$$;

revoke all on function public.league_members_freeze_leaver() from public, anon, authenticated, service_role;

-- ---- 3. backfill (BEFORE the trigger exists: with it, the trigger's "still
-- hidden: keep the snapshot" branch would undo this update) ------------------
drop trigger if exists trg_league_members_freeze_leaver on public.league_members;

update public.league_members m
   set frozen_username = p.username,
       frozen_avatar   = p.avatar,
       frozen_at       = now()
  from public.user_profiles p
 where m.hidden_at is not null
   and m.frozen_at is null
   and p.id::text = lower(m.user_id);   -- text compare: no ::uuid cast on a non-uuid id
-- A hidden row with no profile (or a non-uuid id) still gets its frozen_at, so
-- every hidden row is marked as snapshotted.
update public.league_members
   set frozen_at = now()
 where hidden_at is not null and frozen_at is null;

-- ---- 2b. the trigger ----------------------------------------------------------
create trigger trg_league_members_freeze_leaver
  before insert or update of hidden_at, frozen_username, frozen_avatar, frozen_at
  on public.league_members
  for each row execute function public.league_members_freeze_leaver();

-- ---- 4. the league-aware resolver ------------------------------------------
create or replace function public.league_participant_display_name(p_league_id uuid, p_user_id text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  if p_league_id is not null
     and p_user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select m.frozen_username into v_name
      from public.league_members m
     -- lower(): ids are compared case-insensitively, as get_visible_profiles does, so a
     -- differently-cased id can never fall through to the LIVE name (supabase-reviewer).
     where m.league_id = p_league_id and lower(m.user_id) = lower(p_user_id) and m.hidden_at is not null;
    if found then
      -- participant_display_name's own missing-username fallback, verbatim.
      if v_name is not null and length(trim(v_name)) > 0 then
        return v_name;
      end if;
      return 'Player ' || upper(left(p_user_id, 4));
    end if;
  end if;
  return public.participant_display_name(p_user_id);
end;
$$;

comment on function public.league_participant_display_name(uuid, text) is
  'Frozen leaver names (2026-10-11): a hidden leaver''s name as it was when they left that league; '
  'everyone else participant_display_name. Internal: no API role may execute it.';

revoke all on function public.league_participant_display_name(uuid, text) from public, anon, authenticated, service_role;

-- ---- 5. get_visible_profiles: 20261118000000 + the frozen branch ------------
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
  -- each branch restricted to the requested ids so the work is bounded by the
  -- request, not by the size of the caller's leagues. Cross-table casts per
  -- CLAUDE.md (drafts/league_members/matchups ids are text, trades.user_id is
  -- uuid); lower() because ids are compared as text.
  visible as (
    select w.uid from wanted w where w.uid = v_caller::text
    union
    select lower(m.user_id) from public.league_members m join my_leagues l on l.league_id = m.league_id
     where lower(m.user_id) in (select uid from wanted)
    union
    select lower(s.user_id) from public.league_standings s join my_leagues l on l.league_id = s.league_id
     where lower(s.user_id) in (select uid from wanted)
    union
    select lower(mu.team1_user_id) from public.matchups mu join my_leagues l on l.league_id = mu.league_id
     where lower(mu.team1_user_id) in (select uid from wanted)
    union
    select lower(mu.team2_user_id) from public.matchups mu join my_leagues l on l.league_id = mu.league_id
     where lower(mu.team2_user_id) in (select uid from wanted)
    union
    select lower(d.user_id::text) from public.drafts d join my_leagues l on l.league_id = d.league_id
     where lower(d.user_id::text) in (select uid from wanted)
    union
    select t.user_id::text from public.trades t join my_leagues l on l.league_id = t.league_id
     where t.user_id::text in (select uid from wanted)
  ),
  -- 20261119000000: a leaver the caller now shares ONLY hidden leagues with is
  -- shown as they were when they left (the most recent hide wins). Presence of
  -- a row here is the switch; its frozen values may legitimately be NULL.
  frozen as (
    select distinct on (lower(m.user_id))
           lower(m.user_id) as uid, m.frozen_username, m.frozen_avatar
      from public.league_members m join my_leagues l on l.league_id = m.league_id
     where lower(m.user_id) in (select uid from wanted)
       and lower(m.user_id) <> v_caller::text
       and m.hidden_at is not null
       and not exists (
             select 1 from public.league_members m2 join my_leagues l2 on l2.league_id = m2.league_id
              where lower(m2.user_id) = lower(m.user_id) and m2.hidden_at is null)
     order by lower(m.user_id), m.hidden_at desc
  )
  -- Compare on the uuid column side so user_profiles' primary key is usable.
  select p.id,
         case when f.uid is null then p.username else f.frozen_username end,
         case when f.uid is null then p.avatar   else f.frozen_avatar   end
    from public.user_profiles p
    left join frozen f on f.uid = p.id::text
   where p.id in (select v.uid::uuid from visible v where v.uid is not null);
end;
$$;

comment on function public.get_visible_profiles(text[]) is
  'Audit #8 (2026-10-08): id, username, avatar for the caller and for users who have ever '
  'participated in a league the caller is a current member of. Nothing else, nobody else. '
  'Frozen leaver names (2026-10-11): a leaver shared only through leagues they left reads as they were when they left.';

revoke all on function public.get_visible_profiles(text[]) from public, anon, authenticated, service_role;
grant execute on function public.get_visible_profiles(text[]) to authenticated;
