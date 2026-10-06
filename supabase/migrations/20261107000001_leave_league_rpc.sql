-- ============================================================================
-- Leave league (2/7): leave_league + unhide_league
-- ============================================================================
-- Plan + rulings: docs/migrations/LEAVE_LEAGUE_OPTIONS.md (Giorgio, 2026-10-05).
--
-- CALLER: the leave-league edge function ONLY (service role). It verifies the
-- JWT with getUser() and passes the VERIFIED user id as p_user_id; the function
-- never trusts a client-supplied identity. EXECUTE is revoked from public,
-- anon AND authenticated and granted to service_role only: p_user_id would be
-- forgeable from any client-callable path, and REVOKE FROM PUBLIC alone leaves
-- Supabase's explicit anon/authenticated grants in place (CLAUDE.md,
-- join_league_by_code). Verify with the proacl query below, never assume.
--
-- WHY SERVICE ROLE, NOT A CLIENT-CALLED DEFINER: the freeze release (PR #123,
-- 20261104000000) treats any caller with auth.uid() IS NOT NULL as a user
-- session, SECURITY DEFINER included. Here auth.uid() is NULL, which also keeps
-- PR #9's leagues column guard (20260925000000) on its service branch.
--
-- THE WINDOW (evaluated under the leagues row lock):
--   season_status = 'completed'                         -> HIDE (history kept)
--   draft_status <> 'not_started'                       -> refused locked_in (season)
--   not_started, but the order is set:
--     _draft_order_is_due(draft_date) OR meta state IN ('finalized','locked')
--                                                       -> refused locked_in (order_set)
--   not_started, order not set                          -> LEAVE
--   The two order checks are a CONJUNCTION on purpose: draft_date can be moved
--   later after the order was finalized (state catches that), and the time check
--   covers the gap before the finalize cron flips state (the "effectively
--   finalized is time-based" rule of 20261013000000).
--
-- A LEAVE, in one transaction:
--   1. Commissioner rules (Q4-B, the default until Giorgio rules): the
--      commissioner must name a successor who is a current human member
--      (successor_required / successor_invalid); the sole human is refused
--      (sole_manager). commissioner_id and the successor's role move FIRST.
--   2. DELETE the membership. trg_league_members_draft_order closes the order
--      gap (open), or there is no order yet (random mode before the reveal).
--      The finalized branch is unreachable: the window refused it above.
--   3. Upsert league_roster_reconfirm (the commissioner must confirm before the
--      draft can start), EXCEPT for a Run-it-back invitee (below).
--   4. One member_left notice to the (new) commissioner (not on a repeat:
--      left, rejoined and left again while the same confirmation is owed). The
--      edge function delivers it as a push and settles push_status.
--
-- RUN IT BACK (PR #94, unmerged as of this file) -- written to work whether or
-- not #94 has landed, so it reads #94's objects dynamically:
--   * A renewal league is one with leagues.previous_league_id set (read through
--     to_jsonb(row), so this function compiles and runs without that column),
--     or one where the caller has a league_renewal_responses row.
--   * Its commissioner cannot leave: refused commissioner_cannot_opt_out, the
--     same rule and reason as respond_to_renewal (they cancel the renewal
--     instead). Without this, the DELETE would hit #94's
--     trg_league_members_renewal_sync_delete, which raises for the commissioner.
--   * A renewal INVITEE's leave IS respond_to_renewal('out'): #94's AFTER DELETE
--     trigger flips their reply to 'out' (player-decided, free to flip back
--     until the draft). It writes NO reconfirm row, because the same action
--     through respond_to_renewal writes none either, so the two paths gate the
--     same way, and #94's review ("Start Season 2") is the commissioner's
--     roster confirmation for invitees. #94's renewal_replies_pending blocker
--     counts PENDING replies; a leave never creates one, so the two blockers
--     never fire for the same event.
--   * A NEWCOMER in a renewal league (joined by code, no reply row) leaves like
--     anyone else: a reconfirm row.
--
-- PROVISIONAL TIMESTAMP: see 20261107000000's header.
--
-- POST-PUSH EFFECT CHECKS:
--   SELECT proname, proacl, prosecdef, proconfig FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND proname IN ('leave_league', 'unhide_league');
--   -- proacl = {postgres=X/postgres,service_role=X/postgres}; prosecdef t;
--   -- proconfig = {"search_path=public, pg_temp"}
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
  v_state         text;
  v_renewal       boolean;
  v_invitee       boolean := false;
  v_is_comm       boolean;
  v_others        int;
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

  -- ---- After the season: hide, never delete ---------------------------------
  if v_l.season_status = 'completed' then
    if p_new_commissioner is not null then
      return jsonb_build_object('status', 'refused', 'reason', 'successor_not_allowed');
    end if;
    update public.league_members
       set hidden_at = now()
     where league_id = p_league_id and user_id = p_user_id and hidden_at is null;
    return jsonb_build_object('status', 'hidden', 'already_hidden', not found);
  end if;

  -- ---- Locked in: from the order being set through the whole season ----------
  if coalesce(v_l.draft_status, 'not_started') <> 'not_started' then
    return jsonb_build_object('status', 'refused', 'reason', 'locked_in', 'window', 'season');
  end if;
  select m.state into v_state from public.league_draft_order_meta m where m.league_id = p_league_id;
  if public._draft_order_is_due(v_l.draft_date) or v_state in ('finalized', 'locked') then
    return jsonb_build_object('status', 'refused', 'reason', 'locked_in', 'window', 'order_set');
  end if;

  -- ---- Run it back (dynamic: #94 may not be on this database) ---------------
  v_renewal := (to_jsonb(v_l) ->> 'previous_league_id') is not null;
  v_is_comm := v_l.commissioner_id = p_user_id;
  -- Keyed on the response ROW as well as the link, the way #94's own gate keys
  -- on its rows (supabase-reviewer): a renewal whose link were cleared must not
  -- let its commissioner through to #94's delete trigger.
  if to_regclass('public.league_renewal_responses') is not null then
    execute 'select exists (select 1 from public.league_renewal_responses
                             where league_id = $1 and user_id = $2)'
       into v_invitee using p_league_id, p_user_id;
  end if;
  if v_is_comm and (v_renewal or v_invitee) then
    return jsonb_build_object('status', 'refused', 'reason', 'commissioner_cannot_opt_out');
  end if;

  -- ---- The commissioner hands over first (Q4-B) ------------------------------
  if v_is_comm then
    select count(*)::int into v_others from public.league_members
     where league_id = p_league_id and user_id <> p_user_id and user_id not like 'bot-%';
    if v_others = 0 then
      return jsonb_build_object('status', 'refused', 'reason', 'sole_manager');
    end if;
    if p_new_commissioner is null then
      return jsonb_build_object('status', 'refused', 'reason', 'successor_required');
    end if;
    if p_new_commissioner = p_user_id or p_new_commissioner like 'bot-%' or not exists (
         select 1 from public.league_members
          where league_id = p_league_id and user_id = p_new_commissioner) then
      return jsonb_build_object('status', 'refused', 'reason', 'successor_invalid');
    end if;
  elsif p_new_commissioner is not null then
    return jsonb_build_object('status', 'refused', 'reason', 'successor_not_allowed');
  end if;

  -- Every refusal is above this line: nothing has been written yet.
  select count(*)::int into v_before from public.league_members where league_id = p_league_id;

  if v_is_comm then
    update public.leagues set commissioner_id = p_new_commissioner where id = p_league_id;
    update public.league_members set role = 'commissioner'
     where league_id = p_league_id and user_id = p_new_commissioner;
    v_notify := p_new_commissioner;
  else
    v_notify := v_l.commissioner_id;
  end if;

  delete from public.league_members where league_id = p_league_id and user_id = p_user_id;

  v_reconfirm := not v_invitee;
  -- Left, rejoined, left again while the same confirmation is still owed: the
  -- commissioner already knows. No second notice (push spam via a join/leave
  -- loop, security review), and the commissioner's choice stands.
  select coalesce(r.departed @> jsonb_build_array(jsonb_build_object('user_id', p_user_id)), false)
    into v_repeat
    from public.league_roster_reconfirm r where r.league_id = p_league_id;
  v_repeat := coalesce(v_repeat, false) and v_reconfirm;
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
    'made_commissioner', v_is_comm,
    'members_before', v_before,
    'members_after', v_before - 1,
    -- For the edge function's push only; it never forwards these to the client.
    'notice_id', v_notice,
    'notify_user_id', v_notify,
    'leaver_name', public.participant_display_name(p_user_id),
    'league_name', v_l.name);
end;
$$;

-- ----------------------------------------------------------------------------
-- unhide_league: show a hidden finished league again ("Past leagues").
-- ----------------------------------------------------------------------------
create or replace function public.unhide_league(p_league_id uuid, p_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_league_id is null or p_user_id is null then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  if not exists (select 1 from public.league_members
                  where league_id = p_league_id and user_id = p_user_id) then
    return jsonb_build_object('status', 'refused', 'reason', 'not_member');
  end if;
  update public.league_members set hidden_at = null
   where league_id = p_league_id and user_id = p_user_id and hidden_at is not null;
  return jsonb_build_object('status', 'shown', 'already_shown', not found);
end;
$$;

revoke all on function public.leave_league(uuid, text, text) from public;
revoke all on function public.leave_league(uuid, text, text) from anon;
revoke all on function public.leave_league(uuid, text, text) from authenticated;
grant execute on function public.leave_league(uuid, text, text) to service_role;

revoke all on function public.unhide_league(uuid, text) from public;
revoke all on function public.unhide_league(uuid, text) from anon;
revoke all on function public.unhide_league(uuid, text) from authenticated;
grant execute on function public.unhide_league(uuid, text) to service_role;
