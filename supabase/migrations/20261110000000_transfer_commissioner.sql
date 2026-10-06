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
--   WHEN (Giorgio, 2026-10-06): "a commissioner can only hand over the title
--   before or after a season. From once the draft opens an hour before ... and
--   the end, commissioner cannot change." That is EXACTLY the leave window, so
--   both RPCs read ONE helper, _league_membership_window() below, and can never
--   drift apart:
--     'before_draft'  open   (not_started, T-1h not reached, order not set)
--     'locked'        refused 'locked_in' + window 'order_set' | 'season'
--     'after_season'  open   (season_status = 'completed')
--   After the season this runs on the service path (auth.uid() NULL), so the
--   freeze release's commissioner_id lock (#123, user sessions only) does not
--   apply. The RPC is the gate, and the PGlite suite proves both halves.
--   WHAT, in one transaction under the leagues row lock (FOR UPDATE, the same lock
--   leave_league / join_league_by_code / confirm_league_roster take):
--     leagues.commissioner_id := target; old commissioner's role := 'member';
--     target's role := 'commissioner'; one commissioner_transferred notice to the
--     target (the edge function pushes it and settles push_status).
--   A pending league_roster_reconfirm is now the NEW commissioner's: nothing to
--   move, because confirm_league_roster checks leagues.commissioner_id at call
--   time. chosen_by keeps the old commissioner as history if they had chosen
--   "Invite someone new".
--   After the season the new commissioner is the one who can "Run it back"
--   (renew_league checks the commissioner of the finished league).
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
--   SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trg_leagues_commissioner_via_transfer';  -- O
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

-- ----------------------------------------------------------------------------
-- The membership window: when a member may leave and a commissioner may hand
-- over the title. Internal: no API role may execute it; only the definer RPCs
-- (owner postgres) call it. The caller holds the leagues row lock. Two
-- 'order set' checks, as in 20261107000001: draft_date can move later after the
-- order was finalized (state), and the time check covers the gap before the
-- finalize cron flips state.
-- ----------------------------------------------------------------------------
create or replace function public._league_membership_window(p_league_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_l     public.leagues%rowtype;
  v_state text;
begin
  select * into v_l from public.leagues where id = p_league_id;
  if not found then
    return null;
  end if;
  if v_l.season_status = 'completed' then
    return 'after_season';
  end if;
  if coalesce(v_l.draft_status, 'not_started') <> 'not_started' then
    return 'locked_season';
  end if;
  select m.state into v_state from public.league_draft_order_meta m where m.league_id = p_league_id;
  if public._draft_order_is_due(v_l.draft_date) or v_state in ('finalized', 'locked') then
    return 'locked_order_set';
  end if;
  return 'before_draft';
end;
$$;

revoke all on function public._league_membership_window(uuid) from public, anon, authenticated, service_role;

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
        where league_id = p_league_id and user_id = p_new_commissioner) then
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

-- ----------------------------------------------------------------------------
-- transfer_commissioner is the ONLY way commissioner_id changes (security
-- review, 2026-10-06). Before this, leagues_update_commissioner ([I2a]) let a
-- commissioner's own session rewrite commissioner_id before the draft: PR #9's
-- column guard and #123's freeze both return early for the commissioner while
-- not_started. That write skipped the target checks (an outsider, a bot, a
-- non-member), left league_members.role out of step, sent no notice, and
-- sidestepped 'transfer_first' (hand the id to someone, then leave).
-- A user session (auth.uid() IS NOT NULL) may never change commissioner_id; the
-- service path (the RPC above, migrations) may. SECURITY INVOKER: it only reads
-- auth.uid(). No client code writes commissioner_id on UPDATE (create-league
-- INSERTs it, untouched). An unchanged value in a whole-row UPDATE passes.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_commissioner_change_via_transfer()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and new.commissioner_id is distinct from old.commissioner_id then
    raise exception 'commissioner_transfer_only: the commissioner changes only through a transfer'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_commissioner_change_via_transfer() from public, anon, authenticated, service_role;

drop trigger if exists trg_leagues_commissioner_via_transfer on public.leagues;
create trigger trg_leagues_commissioner_via_transfer
  before update of commissioner_id on public.leagues
  for each row execute function public.enforce_commissioner_change_via_transfer();

revoke all on function public.transfer_commissioner(uuid, text, text) from public;
revoke all on function public.transfer_commissioner(uuid, text, text) from anon;
revoke all on function public.transfer_commissioner(uuid, text, text) from authenticated;
grant execute on function public.transfer_commissioner(uuid, text, text) to service_role;
