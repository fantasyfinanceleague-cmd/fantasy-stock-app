-- ============================================================================
-- Leave league (6/7): a human join clears an "Invite someone new" reconfirmation
-- ============================================================================
-- Design board #call-leave (PR #122): when the commissioner picks "Invite
-- someone new", the card becomes "Waiting for a new manager" and clears ON ITS
-- OWN when someone joins. It clears ONLY here, on the human join path
-- (join-league -> join_league_by_code, service role):
--   * never on add_bots or an [I6] bot insert (bots are 'bot-%' and never
--     reach this function), so a member cannot clear it with a bot;
--   * never on a 'pending' row: the commissioner hasn't chosen yet, and a join
--     is not a choice;
--   * only if the league can start on playoff spots afterwards (matchup:
--     playoff_teams <= members). Otherwise it keeps waiting for more managers,
--     and the commissioner can still "Move forward" with a lower P.
-- When it clears, the draft order is set at once if T-1h has passed (it was
-- waiting on the confirmation, 20261107000006). The rejoin of the very person
-- who left counts: someone joined.
--
-- The function below is 20260930000000's body VERBATIM plus the block marked
-- "20261107000005". CREATE OR REPLACE keeps the ACL; the grants are re-asserted
-- verbatim (service_role only).
--
-- PROVISIONAL TIMESTAMP: see 20261107000000's header.
--
-- POST-PUSH EFFECT CHECK:
--   SELECT proacl, position('league_roster_reconfirm' in prosrc) > 0 AS clears
--     FROM pg_proc WHERE proname = 'join_league_by_code';
--   -- {postgres=X/postgres,service_role=X/postgres}, t
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

  -- 20261107000005: "Invite someone new" was waiting for exactly this.
  delete from league_roster_reconfirm r
   where r.league_id = v_league.id
     and r.choice = 'invite'
     and p_user_id not like 'bot-%'
     and (v_league.league_type is distinct from 'matchup'
          or v_league.playoff_teams is null
          or v_league.playoff_teams <= v_count + 1);   -- v_count was read before this member's insert
  if found then
    -- Its own exception scope: the function-wide unique_violation handler below
    -- must not report a finalize failure as 'already_member' (security review).
    -- A failed finalize rolls back only itself; the join and the clear stand,
    -- and the order is set lazily by the next read or cron tick (every finalize
    -- path re-runs _draft_order_sync), so the gap is recoverable, not permanent.
    begin
      perform _draft_order_sync(v_league.id, false);   -- we hold the league row lock
    exception when others then
      raise warning 'join_league_by_code: deferred draft-order finalize for % (%: %)', v_league.id, sqlstate, sqlerrm;
    end;
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

revoke all on function join_league_by_code(text, text) from public;
revoke all on function join_league_by_code(text, text) from anon;
revoke all on function join_league_by_code(text, text) from authenticated;
grant execute on function join_league_by_code(text, text) to service_role;
