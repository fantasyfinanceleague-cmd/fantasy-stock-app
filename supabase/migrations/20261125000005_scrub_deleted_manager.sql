-- ============================================================================
-- Account deletion (6/8): scrub_deleted_manager
-- ============================================================================
-- Plan: docs/plans/2026-10-21-account-deletion.md, step 4 ("Scrub, one
-- transaction"), decisions 2, 6, 7, 8, 9. Giorgio, 2026-10-21:
--   "A plus C in this plan but we delete the account asap": the seat stays in
--     every league that has drafted and keeps playing; the commissioner can
--     hand it on (take_over_team, 20261125000006).
--   "lets just make the first person to join the league (besides the
--     commissioner) to auto become the commissioner": no picker, no refusal,
--     in every window; a league with nobody else in it is deleted.
--
-- scrub_deleted_manager(p_user_id uuid) -> jsonb. Called by the delete-account
-- edge function (step 4) and by heal_account_deletions (20261125000007), both
-- on the service path. The user id comes only from the JWT, so EXECUTE is
-- service_role ONLY (a client-callable path would let anyone scrub anyone). It
-- refuses ('no_ledger') unless account_deletions has a row for the user, so a
-- stray call can never scrub a live account.
--
-- IN ORDER, in ONE transaction (any error rolls all of it back; the ledger row
-- stays 'requested' and the heal retries):
--   1. Leagues they COMMISSION, newest season first (a renewal is handled
--      before the league it renews):
--        - the earliest-joined other CURRENT human member becomes commissioner:
--          league_members.joined_at, then user_id; never a bot, a hidden
--          leaver or another deleted seat (none of them can run a league).
--          leagues.commissioner_id + both roles, one commissioner_transferred
--          notice for them (transfer_commissioner's writes). The freeze release
--          and trg_leagues_commissioner_via_transfer refuse this only for a USER
--          session (auth.uid() NOT NULL); the service path is the intended one,
--          and the PGlite suite runs it mid-season against the whole live chain.
--        - nobody: the league is DELETED (it cascades), unless a later season's
--          league names it as previous_league_id (ON DELETE RESTRICT): then it is
--          kept as history and its seat is marked like any other.
--   2. Every membership:
--        - window 'before_draft' (_league_membership_window): the SAME leave as
--          leave_league, through _leave_league_before_draft (20261125000004),
--          with the label as the name snapshot: row deleted, reconfirm owed,
--          member_left notice.
--        - any other window (order set, live draft, season, after the season,
--          hidden or not): the seat stays. deleted_at := now() (kept on a
--          re-run); the freeze trigger NULLs frozen_* (20261125000001).
--   3. league_roster_reconfirm.departed entries for them: name := the label.
--   4. Other people's notifications ABOUT them (subject_user_id): the stored
--      subject_name / commissioner_name snapshots := the label.
--   5. Delete their private rows: user_profiles, push_tokens, draft_queue,
--      league_notifications addressed to them, league_renewal_responses where
--      they hold no seat (an unanswered invite would otherwise hold the renewal
--      gate shut forever; a kept seat keeps its 'in' row, so "in <=> member"
--      holds), the PENDING league_invites they sent (invited_identifier is free
--      text and may be an email), and, when those tables exist, their watchlist
--      rows and PENDING claims.
--   6. VERIFY the effect (CLAUDE.md: never trust a status): no profile, no push
--      token, no live membership, no league they commission that a member could
--      run. A breach raises, which rolls everything back.
--   7. Ledger stage 'requested' -> 'scrubbed' (never backward).
--
-- IDEMPOTENT: a re-run finds no commissioned league to hand on (or only kept
-- ones), no pre-draft membership, every kept seat already marked, and every name
-- already the label. It writes NO new notice, so a retry or the heal never
-- double-pushes. Concurrent calls for one user serialize on the ledger row lock.
--
-- NOT TOUCHED, on purpose: the opaque uuid on league rows (matchups,
-- league_standings, week_snapshots, drafts, trades, league_draft_order,
-- league_seasons): it names nobody once the profile is gone, and the seat keeps
-- playing on it (the plan's identity model). draft_stalls (ops history),
-- rate_limit_counters (subject 'user:<uuid>', purged daily by
-- 20261116000001), signup_allowlist (keyed by email; the plan accepts it).
--
-- RETURNS (for the edge function's pushes; never forwarded to a client):
--   { status: 'scrubbed', stage,
--     successions: [{league_id, new_commissioner, notice_id, league_name}],
--     leagues_deleted: [league_id], leagues_kept: [league_id],
--     left: [{league_id, notice_id, notify_user_id, league_name}],
--     seats_marked: [league_id] }
--   or { status: 'refused', reason: 'no_ledger' }.
--
-- PROVISIONAL TIMESTAMP: see 20261125000000.
--
-- POST-PUSH CHECKS (SQL editor):
--   SELECT proacl, prosecdef, proconfig FROM pg_proc WHERE proname = 'scrub_deleted_manager';
--   -- {postgres=X/postgres,service_role=X/postgres}, t, {"search_path=public, pg_temp"}
--   Effect: docs/security/account-deletion-effect-test.sql (read-only).
-- ============================================================================

create or replace function public.scrub_deleted_manager(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid          text;
  v_label        text := public.deleted_manager_label();
  v_stage        text;
  v_l            public.leagues%rowtype;
  v_succ         text;
  v_notice       uuid;
  v_res          jsonb;
  v_successions  jsonb := '[]'::jsonb;
  v_deleted      jsonb := '[]'::jsonb;
  v_kept         jsonb := '[]'::jsonb;
  v_left         jsonb := '[]'::jsonb;
  v_marked       jsonb := '[]'::jsonb;
  r              record;
begin
  if p_user_id is null then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  v_uid := lower(p_user_id::text);

  -- The ledger row is the authorization AND the per-user lock: a client retry and
  -- the heal cannot scrub the same account at once.
  select stage into v_stage from public.account_deletions where user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('status', 'refused', 'reason', 'no_ledger');
  end if;

  -- ---- 1. leagues they commission ----------------------------------------------
  for r in
    select l.id from public.leagues l
     where lower(l.commissioner_id) = v_uid
     order by l.season_number desc, l.created_at desc, l.id
  loop
    select * into v_l from public.leagues where id = r.id for update;
    if not found or lower(v_l.commissioner_id) <> v_uid then
      continue;   -- gone or already handed on while we waited for the lock
    end if;

    select m.user_id into v_succ
      from public.league_members m
     where m.league_id = r.id
       and lower(m.user_id) <> v_uid
       and m.user_id not like 'bot-%'
       and m.hidden_at is null
       and m.deleted_at is null
     order by m.joined_at, m.user_id
     limit 1;

    if found then
      -- transfer_commissioner's writes, minus its window: Giorgio's succession
      -- applies in every window.
      update public.leagues set commissioner_id = v_succ where id = r.id;
      update public.league_members set role = 'member'
       where league_id = r.id and role = 'commissioner' and user_id <> v_succ;
      update public.league_members set role = 'commissioner'
       where league_id = r.id and user_id = v_succ;
      insert into public.league_notifications (league_id, user_id, kind)
      values (r.id, v_succ, 'commissioner_transferred')
      returning id into v_notice;
      v_successions := v_successions || jsonb_build_array(jsonb_build_object(
        'league_id', r.id, 'new_commissioner', v_succ, 'notice_id', v_notice,
        'league_name', v_l.name));
    elsif exists (select 1 from public.leagues s where s.previous_league_id = r.id) then
      -- A later season points here (ON DELETE RESTRICT): keep it as history.
      v_kept := v_kept || jsonb_build_array(to_jsonb(r.id));
    else
      delete from public.leagues where id = r.id;
      v_deleted := v_deleted || jsonb_build_array(to_jsonb(r.id));
    end if;
  end loop;

  -- ---- 2. every membership -------------------------------------------------------
  for r in
    select m.league_id, m.user_id from public.league_members m
     where lower(m.user_id) = v_uid
     order by m.league_id
  loop
    select * into v_l from public.leagues where id = r.league_id for update;
    if not found then
      continue;
    end if;
    if public._league_membership_window(r.league_id) = 'before_draft'
       and lower(v_l.commissioner_id) <> v_uid then
      v_res := public._leave_league_before_draft(r.league_id, r.user_id, v_label);
      v_left := v_left || jsonb_build_array(jsonb_build_object(
        'league_id', r.league_id, 'notice_id', v_res -> 'notice_id',
        'notify_user_id', v_res -> 'notify_user_id', 'league_name', v_res -> 'league_name'));
    else
      update public.league_members
         set deleted_at = now()
       where league_id = r.league_id and user_id = r.user_id and deleted_at is null;
      if found then
        v_marked := v_marked || jsonb_build_array(to_jsonb(r.league_id));
      end if;
    end if;
  end loop;

  -- ---- 3. roster reconfirm snapshots -----------------------------------------------
  update public.league_roster_reconfirm rc
     set departed = (
           select jsonb_agg(case when lower(e ->> 'user_id') = v_uid
                                 then jsonb_set(e, '{name}', to_jsonb(v_label))
                                 else e end
                            order by o)
             from jsonb_array_elements(rc.departed) with ordinality as x(e, o))
   where exists (select 1 from jsonb_array_elements(rc.departed) e
                  where lower(e ->> 'user_id') = v_uid
                    and (e ->> 'name') is distinct from v_label);

  -- ---- 4. stored name snapshots in other people's notifications ---------------------
  update public.league_notifications n
     set detail = n.detail
                  || case when n.detail ? 'subject_name'
                          then jsonb_build_object('subject_name', v_label) else '{}'::jsonb end
                  || case when n.detail ? 'commissioner_name'
                          then jsonb_build_object('commissioner_name', v_label) else '{}'::jsonb end
   where lower(n.subject_user_id) = v_uid
     and ((n.detail ? 'subject_name' and (n.detail ->> 'subject_name') is distinct from v_label)
       or (n.detail ? 'commissioner_name' and (n.detail ->> 'commissioner_name') is distinct from v_label));

  -- ---- 5. their private rows ---------------------------------------------------------
  delete from public.user_profiles where id = p_user_id;
  delete from public.push_tokens where user_id = p_user_id;
  delete from public.draft_queue where lower(user_id) = v_uid;
  delete from public.league_notifications where lower(user_id) = v_uid;
  delete from public.league_renewal_responses rr
   where lower(rr.user_id) = v_uid
     and not exists (select 1 from public.league_members m
                      where m.league_id = rr.league_id and m.user_id = rr.user_id);
  delete from public.league_invites where lower(inviter_id) = v_uid and status = 'pending';
  -- The waiver-wire plan's tables, when they exist (dynamic: not on every database).
  if to_regclass('public.watchlist') is not null then
    execute 'delete from public.watchlist where lower(user_id) = $1' using v_uid;
  end if;
  if to_regclass('public.claims') is not null then
    execute 'delete from public.claims where lower(user_id) = $1 and status = ''pending''' using v_uid;
  end if;

  -- ---- 6. verify the effect ------------------------------------------------------------
  if exists (select 1 from public.user_profiles where id = p_user_id)
     or exists (select 1 from public.push_tokens where user_id = p_user_id)
     or exists (select 1 from public.league_members
                 where lower(user_id) = v_uid and deleted_at is null)
     or exists (select 1 from public.leagues l
                 where lower(l.commissioner_id) = v_uid
                   and exists (select 1 from public.league_members m
                                where m.league_id = l.id and lower(m.user_id) <> v_uid
                                  and m.user_id not like 'bot-%'
                                  and m.hidden_at is null and m.deleted_at is null)) then
    raise exception 'scrub_deleted_manager: effect check failed for %', p_user_id using errcode = 'P0001';
  end if;

  -- ---- 7. the ledger ---------------------------------------------------------------------
  update public.account_deletions
     set stage = 'scrubbed', last_error = null, updated_at = now()
   where user_id = p_user_id and stage = 'requested';
  select stage into v_stage from public.account_deletions where user_id = p_user_id;

  return jsonb_build_object(
    'status', 'scrubbed',
    'stage', v_stage,
    'successions', v_successions,
    'leagues_deleted', v_deleted,
    'leagues_kept', v_kept,
    'left', v_left,
    'seats_marked', v_marked);
end;
$$;

comment on function public.scrub_deleted_manager(uuid) is
  'Account deletion (2026-10-21): succession, pre-draft leaves, seat marks, name scrub and private-row deletes for '
  'one account, in one transaction. Needs an account_deletions row. Idempotent. Service role only.';

revoke all on function public.scrub_deleted_manager(uuid) from public, anon, authenticated;
grant execute on function public.scrub_deleted_manager(uuid) to service_role;
