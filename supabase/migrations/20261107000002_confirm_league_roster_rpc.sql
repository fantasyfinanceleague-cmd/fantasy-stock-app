-- ============================================================================
-- Leave league (3/5): confirm_league_roster, the commissioner's reconfirmation
-- ============================================================================
-- Giorgio (2026-10-05): "commissioner either needs to reconfirm the number of
-- players in the league. if they want to move forward with 1 less they can or
-- they invite someone new to replace".
--
-- A pre-draft leave writes league_roster_reconfirm (20261107000001), and
-- draft-control refuses to start while it exists. This clears it, ONLY on the
-- commissioner's explicit confirmation, even when a replacement has joined and
-- the count is back where it was. Auto-clearing on a join would let any member
-- clear it by inserting a bot through [I6] while that policy lives.
--
-- PLAYOFF SPOTS vs MEMBERS: a leave can leave playoff_teams above the member
-- count, which draft-control's start refuses (playoff_teams_exceeds_members).
-- The commissioner fixes it HERE, in the same call: p_playoff_teams (optional)
-- is validated 2 <= P <= members and written; then, on a matchup league, a P
-- still above the member count is refused. So a confirmed roster is never one
-- the start would refuse on P. (members < 4 is NOT refused here: draft-control's
-- not_enough_members is the right message, and the commissioner may still be
-- inviting.)
--
-- CALLER: draft-control's confirm_roster action (service role), with the
-- VERIFIED user id. EXECUTE: service_role only (same reasoning as leave_league).
-- playoff_teams is still writable before the draft (PR #66's freeze starts at
-- the draft), and auth.uid() is NULL here anyway.
--
-- PROVISIONAL TIMESTAMP: see 20261107000000's header.
--
-- POST-PUSH EFFECT CHECK:
--   SELECT proacl FROM pg_proc WHERE proname = 'confirm_league_roster';
--   -- {postgres=X/postgres,service_role=X/postgres}
-- ============================================================================

create or replace function public.confirm_league_roster(
  p_league_id     uuid,
  p_user_id       text,
  p_playoff_teams int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_l       public.leagues%rowtype;
  v_members int;
  v_p       int;
begin
  if p_league_id is null or p_user_id is null then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;

  select * into v_l from public.leagues where id = p_league_id for update;
  if not found or v_l.commissioner_id is distinct from p_user_id then
    return jsonb_build_object('status', 'refused', 'reason', 'not_commissioner');
  end if;
  if coalesce(v_l.draft_status, 'not_started') <> 'not_started' then
    return jsonb_build_object('status', 'refused', 'reason', 'draft_started');
  end if;
  perform 1 from public.league_roster_reconfirm where league_id = p_league_id for update;
  if not found then
    return jsonb_build_object('status', 'unchanged', 'reason', 'nothing_to_confirm');
  end if;

  select count(*)::int into v_members from public.league_members where league_id = p_league_id;
  v_p := v_l.playoff_teams;

  if p_playoff_teams is not null then
    if v_l.league_type is distinct from 'matchup' then
      return jsonb_build_object('status', 'refused', 'reason', 'playoff_teams_not_applicable');
    end if;
    if p_playoff_teams < 2 or p_playoff_teams > v_members then
      return jsonb_build_object('status', 'refused', 'reason', 'invalid_playoff_teams',
        'playoff_teams', p_playoff_teams, 'members', v_members);
    end if;
    v_p := p_playoff_teams;
  end if;

  if v_l.league_type = 'matchup' and v_p is not null and v_p > v_members then
    return jsonb_build_object('status', 'refused', 'reason', 'playoff_teams_exceeds_members',
      'playoff_teams', v_p, 'members', v_members);
  end if;

  -- Every refusal is above this line: nothing has been written yet.
  if p_playoff_teams is not null and p_playoff_teams is distinct from v_l.playoff_teams then
    update public.leagues set playoff_teams = p_playoff_teams where id = p_league_id;
  end if;
  delete from public.league_roster_reconfirm where league_id = p_league_id;

  return jsonb_build_object('status', 'confirmed', 'members', v_members, 'playoff_teams', v_p);
end;
$$;

revoke all on function public.confirm_league_roster(uuid, text, int) from public;
revoke all on function public.confirm_league_roster(uuid, text, int) from anon;
revoke all on function public.confirm_league_roster(uuid, text, int) from authenticated;
grant execute on function public.confirm_league_roster(uuid, text, int) to service_role;
