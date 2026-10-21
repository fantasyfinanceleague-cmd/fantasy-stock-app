-- ============================================================================
-- Account deletion (9/9): a takeover code is never a join code
-- ============================================================================
-- Plan: docs/plans/2026-10-21-account-deletion.md, "Takeover"; W3's security
-- review (via the Orchestrator, 2026-10-21): a takeover code is a bearer
-- capability for a seat with a record, so it must live ONLY in league_invites
-- kind = 'takeover' and be resolved ONLY by _takeover_check (20261125000006).
--
-- Both existing code resolvers read league_invites.code with no kind filter:
--   1. join_league_by_code (20261123000000) would have resolved a takeover code
--      as an ordinary invite. It was refused today only because a takeover
--      exists only after the draft ('draft_started'), and a refusal that rests
--      on an unrelated rule is one rule change away from a seat. Now a takeover
--      code is 'invalid_code' there, exactly like an unknown one.
--   2. invite_preview_lookup (20261124000000), the no-session web preview, would
--      have named the takeover code's league to anyone. Now it is a MISS there
--      (counted against that limiter's ceilings like any unknown code).
-- In the other direction, _takeover_check reads kind = 'takeover' rows only and
-- never leagues.invite_code.
--
-- NOT IN THIS FILE: supabase/functions/preview-league/index.ts resolves
-- league_invites.code with the service key and no kind filter; that edge
-- function needs `.eq('kind', 'invite')` (reported to the Orchestrator for W3).
--
-- Both bodies are their latest source with only the lines marked
-- "20261125000008" added (the PGlite suite diffs them). CREATE OR REPLACE keeps
-- the ACLs; they are re-asserted verbatim from the source files.
--
-- PROVISIONAL TIMESTAMP: see 20261125000000.
--
-- POST-PUSH CHECKS (SQL editor):
--   SELECT proname, proacl, position('kind = ''invite''' in prosrc) > 0 AS invite_only
--     FROM pg_proc WHERE proname IN ('join_league_by_code', 'invite_preview_lookup');
--   -- both {postgres=X/postgres,service_role=X/postgres}, t
-- ============================================================================

-- ---- 1. join_league_by_code (20261123000000) ---------------------------------
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
    select * into v_invite from league_invites where code = p_code
      and kind = 'invite';   -- 20261125000008: never a takeover code
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
  -- 20261123000000: so is a league whose draft room has opened (T-1h). Same
  -- clock as the room, the order and the leave window: _draft_order_is_due.
  -- A postponed draft has no draft_date, so it stays joinable.
  if v_league.draft_status <> 'not_started'
     or public._draft_order_is_due(v_league.draft_date) then
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

-- ---- 2. invite_preview_lookup (20261124000000) -------------------------------
create or replace function public.invite_preview_lookup(p_code text, p_ip text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
set lock_timeout = '1s'
as $$
declare
  c_uuid   constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_salt   text := public.invite_preview_ip_salt();
  v_ip     text;
  v_minute timestamptz := date_trunc('minute', now());
  v_hour   timestamptz := date_trunc('hour', now());
  v_code   text := upper(btrim(coalesce(p_code, '')));
  v_n      int;
  v_all    int;
  v_mine   int;
  v_league public.leagues%rowtype;
  v_invite public.league_invites%rowtype;
  v_found  boolean := false;
  v_inviter text;
begin
  -- FAIL CLOSED: no usable salt means no way to key the limiter safely, so nothing is looked up or recorded.
  if v_salt is null or length(v_salt) < 16 then
    return jsonb_build_object('status', 'rate_limited', 'limit', 'salt');
  end if;
  v_ip := encode(sha256(convert_to(v_salt || ':' || coalesce(p_ip, ''), 'utf8')), 'hex');

  -- One caller at a time through the check-then-bump below. Under READ COMMITTED a burst would otherwise all read
  -- "9 misses" before any of them commits its miss, and overshoot the ceilings by the burst size. The function is a
  -- few indexed statements, and the edge function's 400 ms response floor is slept OUTSIDE the database call, so
  -- the lock is held for milliseconds. A TRY lock: a caller that cannot have it now is refused, not queued.
  -- Transaction-scoped: released at commit, never leaks.
  if not public.invite_preview_try_lock() then
    return jsonb_build_object('status', 'rate_limited', 'limit', 'contention');
  end if;

  -- Self-pruning: every window older than two hours is dead (the longest is one hour).
  delete from public.invite_preview_limits where window_start < now() - interval '2 hours';

  -- The miss ceilings come FIRST and do not bump: a refused caller cannot spend more of the budget.
  select coalesce(sum(hits), 0) into v_all
    from public.invite_preview_limits where subject = 'miss-all' and window_start = v_hour;
  select coalesce(sum(hits), 0) into v_mine
    from public.invite_preview_limits where subject = 'miss-ip:' || v_ip and window_start = v_hour;
  if v_all >= 300 or v_mine >= 10 then
    return jsonb_build_object('status', 'rate_limited', 'limit', case when v_all >= 300 then 'miss-all' else 'miss-ip' end);
  end if;

  insert into public.invite_preview_limits (subject, window_start, hits)
  values ('ip:' || v_ip, v_minute, 1)
  on conflict (subject, window_start) do update set hits = public.invite_preview_limits.hits + 1
  returning hits into v_n;
  if v_n > 30 then
    return jsonb_build_object('status', 'rate_limited', 'limit', 'ip');
  end if;

  insert into public.invite_preview_limits (subject, window_start, hits)
  values ('req-all', v_minute, 1)
  on conflict (subject, window_start) do update set hits = public.invite_preview_limits.hits + 1
  returning hits into v_n;
  if v_n > 600 then
    return jsonb_build_object('status', 'rate_limited', 'limit', 'req-all');
  end if;

  -- Resolve the code: leagues.invite_code first, else a PENDING, unexpired league_invites.code (the same
  -- order join_league_by_code uses). A malformed code skips the lookup and is a miss.
  if v_code ~ '^[A-Z0-9]{4,12}$' then
    select * into v_league from public.leagues where invite_code = v_code;
    v_found := found;
    if not v_found then
      select * into v_invite from public.league_invites
       where code = v_code and status = 'pending' and (expires_at is null or expires_at > now())
         and kind = 'invite';   -- 20261125000008: a takeover code is a MISS here
      if found then
        select * into v_league from public.leagues where id = v_invite.league_id;
        v_found := found;
      end if;
    end if;
  end if;

  if not v_found then
    insert into public.invite_preview_limits (subject, window_start, hits)
    values ('miss-all', v_hour, 1), ('miss-ip:' || v_ip, v_hour, 1)
    on conflict (subject, window_start) do update set hits = public.invite_preview_limits.hits + 1;
    return jsonb_build_object('status', 'not_found');
  end if;

  -- The commissioner's username ONLY (nothing else of the profile), blank treated as none. commissioner_id is
  -- text (bots are 'bot-N'), so the uuid cast is guarded.
  if v_league.commissioner_id ~* c_uuid then
    select nullif(btrim(p.username), '') into v_inviter
      from public.user_profiles p where p.id = v_league.commissioner_id::uuid;
  end if;

  return jsonb_build_object(
    'status', 'found',
    'name', v_league.name,
    'inviter', v_inviter,
    'season_status', v_league.season_status,
    'draft_status', v_league.draft_status,
    'draft_date', v_league.draft_date,
    'current_members', (select count(*) from public.league_members m where m.league_id = v_league.id),
    'num_participants', v_league.num_participants
  );
end;
$$;

revoke all on function public.invite_preview_lookup(text, text) from public;
revoke all on function public.invite_preview_lookup(text, text) from anon;
revoke all on function public.invite_preview_lookup(text, text) from authenticated;
grant execute on function public.invite_preview_lookup(text, text) to service_role;
