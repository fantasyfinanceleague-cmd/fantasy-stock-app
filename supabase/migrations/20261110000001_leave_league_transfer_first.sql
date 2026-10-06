-- ============================================================================
-- Commissioner transfer (2/3): leave_league refuses the commissioner,
-- 'transfer_first'
-- ============================================================================
-- Giorgio (Q4 = A, 2026-10-06): "A commissioner cannot leave, but a commissioner
-- can transfer that title to someone else and then leave."
--
-- The function below is 20261107000001's applied body with the Q4-B hand-over
-- REMOVED (the lines marked "20261110000001"):
--   * The window is read from _league_membership_window() (20261110000000), the
--     helper transfer_commissioner also reads: identical rules, never drifting.
--   * The commissioner is refused 'transfer_first' in BOTH open windows (before
--     T-1h, and after the season, where "leave" means hide). That holds whether
--     or not other humans remain. A sole human gets the same refusal: they
--     can't transfer to a bot (transfer to someone, or delete the league).
--     During the draft and the season they are locked_in, like everyone.
--   * The order of checks is now window, then commissioner, then hide. Before,
--     it was hide, then window. So a commissioner of a finished league gets
--     transfer_first instead of a hide, and anyone else gets the same results
--     as before.
--   * The Run-it-back commissioner case ('commissioner_cannot_opt_out') folds
--     into 'transfer_first': a renewal league is not_started, so the commissioner
--     can transfer first, then leave as an invitee (#94's trigger flips their
--     reply to 'out').
--   * p_new_commissioner is KEPT in the signature so the edge function deployed
--     with #126 keeps working across the deploy gap (no DROP FUNCTION, which
--     would also reset the ACL). It is vestigial and refused if passed: the
--     commissioner gets 'transfer_first'; anyone else 'successor_not_allowed'.
--     'made_commissioner' stays in the result, always false, for the same reason.
--   * v_renewal is gone: it only fed the folded commissioner refusal. The
--     invitee test reads #94's reply table, as before.
--   * Nothing else changed: the window, the reconfirm upsert, the member_left
--     dedupe (the hand-over clause is now unreachable and removed), the
--     invitee path.
-- CREATE OR REPLACE keeps the existing ACL (service_role only). It is
-- re-asserted below verbatim; verify with the proacl query.
--
-- PROVISIONAL TIMESTAMP: see 20261110000000's header.
--
-- POST-PUSH EFFECT CHECK:
--   SELECT proacl, position('transfer_first' in prosrc) > 0 AS q4a FROM pg_proc WHERE proname = 'leave_league';
--   -- {postgres=X/postgres,service_role=X/postgres}, t
-- ============================================================================

create or replace function public.leave_league(
  p_league_id        uuid,
  p_user_id          text,
  p_new_commissioner text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_l             public.leagues%rowtype;
  v_window        text;
  v_invitee       boolean := false;
  v_is_comm       boolean;
  v_before        int;
  v_notify        text;
  v_notice        uuid;
  v_reconfirm     boolean;
  v_entry         jsonb;
  v_repeat        boolean := false;
begin
  if p_league_id is null or p_user_id is null or btrim(p_user_id) = '' then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;

  -- Lock the league FIRST: joins (join_league_by_code), renewal replies, the
  -- draft-order trigger and the commissioner's date edits all serialize on it.
  select * into v_l from public.leagues where id = p_league_id for update;
  -- Uniform for an unknown league and a non-member (no existence oracle).
  if not found or p_user_id like 'bot-%' or not exists (
       select 1 from public.league_members
        where league_id = p_league_id and user_id = p_user_id) then
    return jsonb_build_object('status', 'refused', 'reason', 'not_member');
  end if;

  -- ---- 20261110000001: the window comes from the ONE helper transfer_commissioner
  -- also reads, so leaving and handing over the title can never drift apart.
  v_window := public._league_membership_window(p_league_id);
  if v_window = 'locked_season' then
    return jsonb_build_object('status', 'refused', 'reason', 'locked_in', 'window', 'season');
  elsif v_window = 'locked_order_set' then
    return jsonb_build_object('status', 'refused', 'reason', 'locked_in', 'window', 'order_set');
  end if;

  -- ---- 20261110000001: the commissioner transfers first (Q4 = A), in BOTH open
  -- windows. Before any Run-it-back read: this also covers the renewal
  -- commissioner, who must not reach #94's delete trigger.
  v_is_comm := v_l.commissioner_id = p_user_id;
  if v_is_comm then
    return jsonb_build_object('status', 'refused', 'reason', 'transfer_first');
  end if;
  if p_new_commissioner is not null then
    return jsonb_build_object('status', 'refused', 'reason', 'successor_not_allowed');
  end if;

  -- ---- After the season: hide, never delete ---------------------------------
  if v_window = 'after_season' then
    update public.league_members
       set hidden_at = now()
     where league_id = p_league_id and user_id = p_user_id and hidden_at is null;
    return jsonb_build_object('status', 'hidden', 'already_hidden', not found);
  end if;

  -- ---- Run it back (dynamic: #94 may not be on this database) ---------------
  if to_regclass('public.league_renewal_responses') is not null then
    execute 'select exists (select 1 from public.league_renewal_responses
                             where league_id = $1 and user_id = $2)'
       into v_invitee using p_league_id, p_user_id;
  end if;

  -- Every refusal is above this line: nothing has been written yet.
  select count(*)::int into v_before from public.league_members where league_id = p_league_id;

  v_notify := v_l.commissioner_id;   -- 20261110000001: the leaver is never the commissioner now

  delete from public.league_members where league_id = p_league_id and user_id = p_user_id;

  v_reconfirm := not v_invitee;
  -- Left, rejoined, left again while the same confirmation is still owed: the
  -- commissioner already knows. No second notice (push spam via a join/leave
  -- loop, security review), and the commissioner's choice stands.
  select coalesce(r.departed @> jsonb_build_array(jsonb_build_object('user_id', p_user_id)), false)
    into v_repeat
    from public.league_roster_reconfirm r where r.league_id = p_league_id;
  v_repeat := coalesce(v_repeat, false) and v_reconfirm;   -- 20261110000001: no hand-over clause left
  if v_reconfirm then
    -- The name is a SNAPSHOT: once the row is gone, a pre-draft leaver has no
    -- standings/matchups/drafts for get_league_display_names to resolve.
    v_entry := jsonb_build_object('user_id', p_user_id,
                                  'name', public.participant_display_name(p_user_id),
                                  'left_at', now());
    insert into public.league_roster_reconfirm as r (league_id, departed, members_before)
    values (p_league_id, jsonb_build_array(v_entry), v_before)
    on conflict (league_id) do update
      set departed  = case when v_repeat then r.departed else r.departed || jsonb_build_array(v_entry) end,
          -- A NEW departure re-opens the question: whatever the commissioner chose
          -- ("Invite someone new") was for a different roster.
          choice    = case when v_repeat then r.choice    else 'pending' end,
          chosen_by = case when v_repeat then r.chosen_by else null end,
          chosen_at = case when v_repeat then r.chosen_at else null end,
          updated_at = now();   -- members_before stays: the count before the FIRST unconfirmed leave
  end if;

  if not v_repeat then
    insert into public.league_notifications (league_id, user_id, kind)
    values (p_league_id, v_notify, 'member_left')
    returning id into v_notice;
  end if;

  return jsonb_build_object(
    'status', 'left',
    'reconfirm_required', v_reconfirm,
    'made_commissioner', false,   -- 20261110000001: kept for the #126-era edge function; always false
    'members_before', v_before,
    'members_after', v_before - 1,
    -- For the edge function's push only; it never forwards these to the client.
    'notice_id', v_notice,
    'notify_user_id', v_notify,
    'leaver_name', public.participant_display_name(p_user_id),
    'league_name', v_l.name);
end;
$$;

revoke all on function public.leave_league(uuid, text, text) from public;
revoke all on function public.leave_league(uuid, text, text) from anon;
revoke all on function public.leave_league(uuid, text, text) from authenticated;
grant execute on function public.leave_league(uuid, text, text) to service_role;
