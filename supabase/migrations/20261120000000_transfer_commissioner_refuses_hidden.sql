-- ============================================================================
-- transfer_commissioner refuses a member who has LEFT (hidden_at set)
-- ============================================================================
-- FINDING (2026-10-11, supabase-reviewer + the frozen-leaver-names worker):
-- after the season, leaving a league sets league_members.hidden_at and keeps the
-- row (leave_league, 20261110000001). transfer_commissioner (20261110000000) asks
-- only "is the target a row in league_members?", so a player who has already
-- left a finished league could be handed its title. The commissioner of a
-- league is someone who is in it (PRODUCT_RULES, "The commissioner": the title
-- goes "to someone else" so the commissioner can then leave). A leaver is not a
-- current member.
--
-- The window makes this reachable in exactly one place: hidden_at is set only
-- once season_status = 'completed', and that is the 'after_season' window,
-- which is open for a transfer.
--
-- THE CHANGE: this function is a SUPERSET of 20261110000000's definition. The
-- only difference is one predicate in the target check, marked "20261120000000":
--   ... where league_id = p_league_id and user_id = p_new_commissioner
--         and hidden_at is null
-- Refusal shape and vocabulary are unchanged: {status:'refused',
-- reason:'target_invalid'}, the same answer as a bot, an outsider or the caller
-- (the leave-league edge function forwards it as-is, logic.ts clientResponse).
-- Every refusal is still above the first write, so a refused transfer writes
-- nothing.
--
-- Unchanged, and checked:
--   * _league_membership_window() reads only leagues and league_draft_order_meta;
--     it never reads a member row, so it cannot treat a leaver as current.
--   * The caller side: the caller must equal leagues.commissioner_id. A
--     commissioner cannot hide (leave_league refuses 'transfer_first'), so the
--     caller is never hidden; with this fix the TARGET never is either.
--   * unhide_league is meant to act on a hidden row; renew_league already
--     skips hidden members (20261115000003).
--
-- GRANTS: CREATE OR REPLACE keeps the existing ACL (service_role only). It is
-- re-asserted below verbatim from 20261110000000 (REVOKE FROM PUBLIC alone
-- leaves Supabase's explicit anon/authenticated grants; CLAUDE.md).
--
-- POST-PUSH EFFECT CHECKS (also docs/security/leaver-gaps-effect-test.sql):
--   SELECT proacl, prosecdef, proconfig,
--          position('hidden_at is null' in prosrc) > 0 AS refuses_hidden
--     FROM pg_proc WHERE proname = 'transfer_commissioner';
--   -- {postgres=X/postgres,service_role=X/postgres}, t, {"search_path=public, pg_temp"}, t
--   SELECT has_function_privilege('anon', 'public.transfer_commissioner(uuid,text,text)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.transfer_commissioner(uuid,text,text)', 'EXECUTE'),
--          has_function_privilege('service_role', 'public.transfer_commissioner(uuid,text,text)', 'EXECUTE');
--   -- f, f, t
-- ============================================================================

create or replace function public.transfer_commissioner(
  p_league_id        uuid,
  p_user_id          text,
  p_new_commissioner text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_l      public.leagues%rowtype;
  v_notice uuid;
  v_window text;
begin
  if p_league_id is null or p_user_id is null or btrim(p_user_id) = '' then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;

  select * into v_l from public.leagues where id = p_league_id for update;
  -- Uniform for an unknown league and a non-commissioner (no existence oracle).
  if not found or v_l.commissioner_id is distinct from p_user_id then
    return jsonb_build_object('status', 'refused', 'reason', 'not_commissioner');
  end if;
  v_window := public._league_membership_window(p_league_id);
  if v_window = 'locked_order_set' then
    return jsonb_build_object('status', 'refused', 'reason', 'locked_in', 'window', 'order_set');
  elsif v_window = 'locked_season' then
    return jsonb_build_object('status', 'refused', 'reason', 'locked_in', 'window', 'season');
  end if;
  if p_new_commissioner is null or p_new_commissioner = p_user_id
     or p_new_commissioner like 'bot-%' or not exists (
       select 1 from public.league_members
        where league_id = p_league_id and user_id = p_new_commissioner
          and hidden_at is null) then   -- 20261120000000: a player who has left is not a current member
    return jsonb_build_object('status', 'refused', 'reason', 'target_invalid');
  end if;

  -- Every refusal is above this line: nothing has been written yet.
  update public.leagues set commissioner_id = p_new_commissioner where id = p_league_id;
  -- Every stale 'commissioner' role goes, not just the caller's (a legacy row
  -- could carry one). The authority is leagues.commissioner_id; the role column
  -- is display, and is kept exactly in step.
  update public.league_members set role = 'member'
   where league_id = p_league_id and role = 'commissioner' and user_id <> p_new_commissioner;
  update public.league_members set role = 'commissioner'
   where league_id = p_league_id and user_id = p_new_commissioner;

  insert into public.league_notifications (league_id, user_id, kind)
  values (p_league_id, p_new_commissioner, 'commissioner_transferred')
  returning id into v_notice;

  return jsonb_build_object(
    'status', 'transferred',
    'window', v_window,   -- 'before_draft' | 'after_season'
    'reconfirm_owed', exists (select 1 from public.league_roster_reconfirm r where r.league_id = p_league_id),
    -- For the edge function's push only; it never forwards these to the client.
    'notice_id', v_notice,
    'notify_user_id', p_new_commissioner,
    'from_name', public.participant_display_name(p_user_id),
    'league_name', v_l.name);
end;
$$;

revoke all on function public.transfer_commissioner(uuid, text, text) from public;
revoke all on function public.transfer_commissioner(uuid, text, text) from anon;
revoke all on function public.transfer_commissioner(uuid, text, text) from authenticated;
grant execute on function public.transfer_commissioner(uuid, text, text) to service_role;
