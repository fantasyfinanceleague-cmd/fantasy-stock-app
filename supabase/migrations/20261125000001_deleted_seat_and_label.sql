-- ============================================================================
-- Account deletion (2/9): the deleted seat, its label, and the two name seams
-- ============================================================================
-- Plan: docs/plans/2026-10-21-account-deletion.md, "The seat mark" and "The
-- name seam". Giorgio, 2026-10-21, on the leaver rule's "No 'Former manager'
-- label": "we stick with the plan and change the product rules. we need to
-- comply with the apple rules." So a DELETED manager's name and avatar are
-- scrubbed everywhere and the seat reads a placeholder label (PRODUCT_RULES,
-- "Who can see other players", the one exception).
--
-- WHAT THIS FILE DOES
--   1. league_members.deleted_at timestamptz: THE discriminator for a deleted
--      manager's seat (NULL = a live manager, or a leaver). Only
--      scrub_deleted_manager (20261125000005) sets it; take_over_team
--      (20261125000006) clears it. Nothing may key the placeholder on
--      "frozen_username IS NULL": a leaver with no username has a NULL frozen
--      name too (CLAUDE.md, "Overloaded NULLs are type tags").
--   2. deleted_manager_label(): the ONE place the wording lives ("Former
--      manager", the Planner's recommendation; the Design Lead board may change
--      it to "Open team": edit this constant, nothing else). It contains a
--      space, so it can never equal a username (user_profiles_username_format
--      is ^[A-Za-z0-9_]{3,20}$); the PGlite suite pins that. It is executable by
--      authenticated and service_role (a constant, no data) so the app and the
--      edge functions read it instead of hardcoding it.
--   3. league_members_freeze_leaver (20261119000000) gains a FIRST branch: a
--      deleted seat holds no frozen name or avatar, ever. Without it the
--      trigger's "still hidden: keep the snapshot" branch would silently undo
--      the scrub on a seat that was hidden (left after the season) before the
--      account was deleted. The trigger also fires on deleted_at now.
--   4. league_participant_display_name (20261119000000) gains a FIRST branch:
--      a deleted seat in that league reads deleted_manager_label(). It runs
--      before the frozen branch and before participant_display_name, so a
--      deleted seat can never show the 'Player XXXX' missing-username fallback
--      (its profile is gone). Every mobile name comes through this seam.
--   5. get_visible_profiles (20261119000000) gains the same branch for the web:
--      an id with a deleted seat in one of the caller's leagues returns
--      (id, label, NULL avatar). The deleted manager has no user_profiles row
--      any more, so without an explicit row they would simply vanish from the
--      result (the web's own fallback label), never the placeholder.
--   Everything else in the re-created bodies is byte-identical to the source
--   (marked "20261125000001" where it changed). Grants are re-asserted.
--
-- SECURITY. All three re-created functions keep SECURITY DEFINER, the pinned
-- search_path, and their ACLs (league_members_freeze_leaver and
-- league_participant_display_name: owner only; get_visible_profiles:
-- authenticated). CREATE OR REPLACE keeps ACLs, and they are re-asserted
-- verbatim anyway. Clients cannot write deleted_at: league_members has no
-- UPDATE policy, and 20261125000002 forbids inserting a row born deleted.
--
-- PROVISIONAL TIMESTAMP: see 20261125000000.
--
-- POST-PUSH CHECKS (SQL editor):
--   SELECT proname, prosecdef, proconfig, proacl FROM pg_proc
--    WHERE proname IN ('deleted_manager_label', 'league_members_freeze_leaver',
--                      'league_participant_display_name', 'get_visible_profiles');
--   -- deleted_manager_label {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres};
--   -- freeze_leaver + league_participant_display_name {postgres=X/postgres};
--   -- get_visible_profiles {postgres=X/postgres,authenticated=X/postgres}.
--   SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_league_members_freeze_leaver';
--   -- ... UPDATE OF hidden_at, deleted_at, frozen_username, frozen_avatar, frozen_at ...
-- ============================================================================

alter table public.league_members
  add column if not exists deleted_at timestamptz;

comment on column public.league_members.deleted_at is
  'Account deletion (20261125000001): set when this seat''s manager deleted their account. THE discriminator for '
  'the placeholder label; frozen_* are NULL on such a seat. NULL = a live manager or a leaver (hidden_at). Only '
  'scrub_deleted_manager sets it; take_over_team clears it.';

-- ---- 2. the label ------------------------------------------------------------
create or replace function public.deleted_manager_label()
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select 'Former manager'::text
$$;

comment on function public.deleted_manager_label() is
  'Account deletion (2026-10-21): the name a deleted manager''s seat shows everywhere. The ONE place the wording '
  'lives. Must never match the username format (it contains a space).';

revoke all on function public.deleted_manager_label() from public, anon, authenticated, service_role;
grant execute on function public.deleted_manager_label() to authenticated, service_role;

-- ---- 3. the freeze trigger: a deleted seat holds no snapshot -----------------
create or replace function public.league_members_freeze_leaver()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.deleted_at is not null then
    -- 20261125000001: a deleted manager's seat keeps NO name or avatar, hidden
    -- or not (the account-deletion scrub). Checked first, so the "still hidden:
    -- keep the snapshot" branch below can never restore one.
    new.frozen_username := null;
    new.frozen_avatar   := null;
    new.frozen_at       := null;
  elsif new.hidden_at is null then
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

-- 20261125000001: deleted_at joins the column list, so the scrub's write fires it.
drop trigger if exists trg_league_members_freeze_leaver on public.league_members;
create trigger trg_league_members_freeze_leaver
  before insert or update of hidden_at, deleted_at, frozen_username, frozen_avatar, frozen_at
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
    -- 20261125000001: a deleted manager's seat reads the placeholder, FIRST: before
    -- the frozen branch (a hidden seat that was then deleted) and before
    -- participant_display_name (whose 'Player XXXX' fallback is what a
    -- profile-less id would otherwise get).
    if exists (select 1 from public.league_members m
                where m.league_id = p_league_id and lower(m.user_id) = lower(p_user_id)
                  and m.deleted_at is not null) then
      return public.deleted_manager_label();
    end if;
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
  'everyone else participant_display_name. Account deletion (2026-10-21): a deleted manager''s seat reads '
  'deleted_manager_label(), first. Internal: no API role may execute it.';

revoke all on function public.league_participant_display_name(uuid, text) from public, anon, authenticated, service_role;

-- ---- 5. get_visible_profiles: 20261119000000 + the deleted branch ------------
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
  ),
  -- 20261125000001: a visible id with a deleted seat in one of the caller's
  -- leagues. Deletion is account-wide, so one such seat decides it. deleted_at
  -- is the switch (never the NULL frozen columns). The deleted manager has no
  -- user_profiles row, so this branch supplies the row itself.
  deleted as (
    select distinct lower(m.user_id) as uid
      from public.league_members m join my_leagues l on l.league_id = m.league_id
     where lower(m.user_id) in (select uid from visible)
       and lower(m.user_id) <> v_caller::text
       and m.deleted_at is not null
  )
  -- Compare on the uuid column side so user_profiles' primary key is usable.
  select p.id,
         case when f.uid is null then p.username else f.frozen_username end,
         case when f.uid is null then p.avatar   else f.frozen_avatar   end
    from public.user_profiles p
    left join frozen f on f.uid = p.id::text
   where p.id in (select v.uid::uuid from visible v where v.uid is not null)
     and p.id::text not in (select d.uid from deleted d)   -- 20261125000001
  union all
  select d.uid::uuid, public.deleted_manager_label(), null::text   -- 20261125000001
    from deleted d;
end;
$$;

comment on function public.get_visible_profiles(text[]) is
  'Audit #8 (2026-10-08): id, username, avatar for the caller and for users who have ever '
  'participated in a league the caller is a current member of. Nothing else, nobody else. '
  'Frozen leaver names (2026-10-11): a leaver shared only through leagues they left reads as they were when they left. '
  'Account deletion (2026-10-21): a deleted manager reads deleted_manager_label() with no avatar.';

revoke all on function public.get_visible_profiles(text[]) from public, anon, authenticated, service_role;
grant execute on function public.get_visible_profiles(text[]) to authenticated;
