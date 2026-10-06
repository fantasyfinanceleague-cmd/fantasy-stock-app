-- ============================================================================
-- Commissioner transfer (1/3): transfer_commissioner + the commissioner_transferred
-- notice kind
-- ============================================================================
-- Giorgio (Q4 = A, 2026-10-06): "A commissioner cannot leave, but a commissioner
-- can transfer that title to someone else and then leave." #126 shipped Q4-B
-- (a successor named inside the leave). It is applied in prod, so its files are
-- immutable, and this replaces the behavior with new migrations:
--   20261110000000  transfer_commissioner (this file) + the notice kind
--   20261110000001  leave_league refuses the commissioner: 'transfer_first'
--   20261110000002  draft_order_notify_due ignores commissioner_transferred
--
-- transfer_commissioner(p_league_id, p_user_id, p_new_commissioner)
--   CALLER: the leave-league edge function's `transfer` action ONLY (service
--   role), with the JWT-verified user id as p_user_id. EXECUTE is revoked from
--   public, anon AND authenticated and granted to service_role only: p_user_id
--   would be forgeable from any client-callable path, and REVOKE FROM PUBLIC
--   alone leaves Supabase's explicit anon/authenticated grants (CLAUDE.md). Verify
--   by proacl.
--   WHO: the caller must be the league's current commissioner. The target must be
--   a current HUMAN member (never 'bot-%') other than the caller.
--   WHEN: ONLY while draft_status = 'not_started' (the Orchestrator's ruling).
--   After that the commissioner is locked in like everyone else. The freeze
--   release (#123) already freezes commissioner_id for user sessions post-draft,
--   but this is the service path, which #123 exempts, so the RPC enforces the
--   window itself ('draft_started').
--   WHAT, in one transaction under the leagues row lock (FOR UPDATE, the same lock
--   leave_league / join_league_by_code / confirm_league_roster take):
--     leagues.commissioner_id := target; old commissioner's role := 'member';
--     target's role := 'commissioner'; one commissioner_transferred notice to the
--     target (the edge function pushes it and settles push_status).
--   A pending league_roster_reconfirm is now the NEW commissioner's: nothing to
--   move, because confirm_league_roster checks leagues.commissioner_id at call
--   time. chosen_by keeps the old commissioner as history if they had chosen
--   "Invite someone new".
--   Run it back (#94, unmerged): a transfer in a renewal league is fine. The
--   target is a member, so their reply is 'in', and #94's "the commissioner
--   cannot opt out" trigger only fires on a write to a reply row, which this
--   function never makes. #94's other triggers (renewal gate, lineage) watch
--   columns this function doesn't touch.
--
-- league_notifications.kind += 'commissioner_transferred'. The CHECK is the UNION
-- of everything live: draft_order_set, #94's five renewal kinds, member_left
-- (20261107000000) and the new kind. CONFLICT NOTE, as in 20261107000000: if #94
-- is ever re-stamped to apply AFTER this file, its CHECK must carry member_left
-- AND commissioner_transferred.
--
-- PROVISIONAL TIMESTAMP: 20261110000000-02 may be re-stamped at release. Re-stamp
-- only these unapplied files, never an applied one (CLAUDE.md).
--
-- POST-PUSH EFFECT CHECKS (also in docs/security/leave-league-effect-test.sql):
--   SELECT proacl, prosecdef, proconfig FROM pg_proc WHERE proname = 'transfer_commissioner';
--   -- {postgres=X/postgres,service_role=X/postgres}, t, {"search_path=public, pg_temp"}
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'league_notifications_kind_check';
--   -- lists all 8 kinds
-- ============================================================================

alter table public.league_notifications
  drop constraint if exists league_notifications_kind_check;
alter table public.league_notifications
  add constraint league_notifications_kind_check check (kind in (
    'draft_order_set',
    -- PR #94 (Run it back) kinds, kept so this CHECK is a superset of its own:
    'renewal_invite', 'renewal_reply', 'renewal_nudge', 'renewal_removed', 'season_set',
    'member_left',               -- to the commissioner: a manager left before the draft
    'commissioner_transferred'   -- to the new commissioner: the title was handed to them
  ));

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
begin
  if p_league_id is null or p_user_id is null or btrim(p_user_id) = '' then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;

  select * into v_l from public.leagues where id = p_league_id for update;
  -- Uniform for an unknown league and a non-commissioner (no existence oracle).
  if not found or v_l.commissioner_id is distinct from p_user_id then
    return jsonb_build_object('status', 'refused', 'reason', 'not_commissioner');
  end if;
  if coalesce(v_l.draft_status, 'not_started') <> 'not_started' then
    return jsonb_build_object('status', 'refused', 'reason', 'draft_started');
  end if;
  if p_new_commissioner is null or p_new_commissioner = p_user_id
     or p_new_commissioner like 'bot-%' or not exists (
       select 1 from public.league_members
        where league_id = p_league_id and user_id = p_new_commissioner) then
    return jsonb_build_object('status', 'refused', 'reason', 'target_invalid');
  end if;

  -- Every refusal is above this line: nothing has been written yet.
  update public.leagues set commissioner_id = p_new_commissioner where id = p_league_id;
  update public.league_members set role = 'member'
   where league_id = p_league_id and user_id = p_user_id;
  update public.league_members set role = 'commissioner'
   where league_id = p_league_id and user_id = p_new_commissioner;

  insert into public.league_notifications (league_id, user_id, kind)
  values (p_league_id, p_new_commissioner, 'commissioner_transferred')
  returning id into v_notice;

  return jsonb_build_object(
    'status', 'transferred',
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
