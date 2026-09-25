-- ============================================================================
-- join_league_by_code — refuse joins once a league's draft has started
-- ============================================================================
-- Found 2026-09-25 by the mobile-draft worker: join_league_by_code (defined
-- 20260716000000, SECURITY DEFINER, EXECUTE service_role only) checks CAPACITY
-- and season_status, but never draft_status. A user who joins by invite code
-- mid-draft (or after it) gets inserted into league_members, which:
--   (a) reshuffles computeDraftOrder (commissioner first, then member ids
--       sorted) for every client mid-draft, and
--   (b) raises finalize_league_draft's (20260926000000) completion threshold
--       (members * num_rounds), so it waits on picks the new member never
--       gets a turn to make, or refuses as roster_mismatch.
--
-- Fix: refuse with a distinct reason ('draft_started') unless
-- draft_status = 'not_started'. Positioned AFTER the `FOR UPDATE` row lock
-- (so it sees a draft-start that commits concurrently -- draft-start is a
-- client UPDATE on the same leagues row, e.g. web DraftPage.jsx `handleStartDraft`,
-- so the lock serializes the two: either this join commits first and is
-- legitimate, or it sees 'in_progress'/'completed' and is refused) and AFTER
-- already_member (so an existing member re-submitting the code mid-draft still
-- gets the existing silent-success path the web client relies on). The refusal
-- is BEFORE the league_invites UPDATE, so a refused join does not consume the
-- invite code.
--
-- draft_status = 'completed' is refused too: start_new_league_season does NOT
-- reset draft_status (rosters carry over across seasons), so a new member
-- joining a completed-draft league would have no drafted roster either.
--
-- Everything else in the function body is UNCHANGED (capacity check, unique-
-- violation handling, FOR UPDATE locking, invite resolution order).
-- ============================================================================

create or replace function join_league_by_code(p_code text, p_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_league      leagues%rowtype;
  v_invite      league_invites%rowtype;
  v_from_invite boolean := false;
  v_count       int;
begin
  -- resolve code: leagues.invite_code FIRST, else league_invites.code (mirrors client)
  select * into v_league from leagues where invite_code = p_code;
  if not found then
    select * into v_invite from league_invites where code = p_code;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'invalid_code');
    end if;
    select * into v_league from leagues where id = v_invite.league_id;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'invalid_code');
    end if;
    v_from_invite := true;
  end if;

  -- LOCK the league row -> serialize concurrent joins (last-seat capacity race fix)
  -- and concurrent draft-starts (see header comment above).
  select * into v_league from leagues where id = v_league.id for update;

  -- re-validate under the lock (season_status now: 'active'|'playoffs'|'completed')
  if v_league.season_status = 'completed' then
    return jsonb_build_object('ok', false, 'reason', 'season_completed');
  end if;

  if v_from_invite and (v_invite.status <> 'pending'
       or (v_invite.expires_at is not null and v_invite.expires_at < now())) then
    return jsonb_build_object('ok', false, 'reason', 'invite_expired');
  end if;

  if exists (select 1 from league_members
             where league_id = v_league.id and user_id = p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'already_member',
      'league', jsonb_build_object('id', v_league.id, 'name', v_league.name));
  end if;

  -- draft_status != 'not_started' -> refuse. Distinct reason so clients can
  -- surface "This league's draft has already started" instead of a generic
  -- failure. See header comment for why this sits here (after the lock and
  -- after already_member) and why 'completed' is refused too.
  if v_league.draft_status <> 'not_started' then
    return jsonb_build_object('ok', false, 'reason', 'draft_started',
      'league', jsonb_build_object('id', v_league.id, 'name', v_league.name));
  end if;

  select count(*) into v_count from league_members where league_id = v_league.id;
  if v_count >= v_league.num_participants then
    return jsonb_build_object('ok', false, 'reason', 'league_full');
  end if;

  insert into league_members (league_id, user_id, role)
  values (v_league.id, p_user_id, 'member');

  if v_from_invite then
    update league_invites set status = 'accepted' where id = v_invite.id;
  end if;

  return jsonb_build_object('ok', true,
    'league', jsonb_build_object('id', v_league.id, 'name', v_league.name));

exception
  -- composite PK (league_id, user_id): a concurrent same-user double-submit that
  -- slipped past the pre-check -> resolve to a clean already_member, not a 500.
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'already_member',
      'league', jsonb_build_object('id', v_league.id, 'name', v_league.name));
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants: CREATE OR REPLACE preserves the existing ACL (this function was
-- already locked to service_role-only by 20260718000001), but re-assert
-- explicitly per CLAUDE.md ("Postgres function grants") -- REVOKE FROM PUBLIC
-- does not clear Supabase's default per-role anon/authenticated grants, and
-- CREATE OR REPLACE does not reset privileges either way.
-- ----------------------------------------------------------------------------
revoke all on function join_league_by_code(text, text) from public;
revoke all on function join_league_by_code(text, text) from anon;
revoke all on function join_league_by_code(text, text) from authenticated;
grant execute on function join_league_by_code(text, text) to service_role;

-- ============================================================================
-- VERIFICATION (run after `db push`)
-- ============================================================================
-- 1. ACL + search_path + security definer:
--    SELECT proname, proacl, proconfig, prosecdef
--    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND proname = 'join_league_by_code';
--    Expect: proacl = {postgres=X/postgres, service_role=X/postgres} (no anon,
--    no authenticated, no bare PUBLIC entry); proconfig contains
--    'search_path=public, pg_temp'; prosecdef = true.
--
-- 2. Body actually changed (defends against a no-op push / stale deploy):
--    SELECT position('draft_started' in prosrc) > 0 AS has_draft_check
--    FROM pg_proc WHERE proname = 'join_league_by_code';
--    Expect: true.
--
-- 3. Effect test: docs/security/join-mid-draft-effect-test.sql (self-contained
--    fixture, rolls back via RAISE, safe to run in the SQL editor).
-- ============================================================================
