-- ============================================================================
-- preview-league / join-league — shared infra + atomic join RPC
-- ============================================================================
-- Backs the preview-league + join-league edge functions that restore
-- join-by-code SERVER-SIDE after B1 locked leagues/league_members/league_invites
-- to members-only. Both functions call these via the secret key (service_role).
--
-- APPLY ORDER: this migration -> deploy both functions -> cut both clients over
-- -> THEN the separate [I7] drop (docs/migrations/STAGED_drop_i7_*.sql, held
-- until clients are live so invite-accepts don't 0-row in the gap).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Rate-limit counters (shared; both functions are enumeration oracles).
--    Service-role-only: RLS ON with NO policies => clients cannot touch it.
-- ----------------------------------------------------------------------------
create table if not exists rate_limit_counters (
  bucket       text not null,          -- 'preview-league' | 'join-league'
  subject      text not null,          -- 'user:<uid>' | 'ip:<addr>'
  window_start timestamptz not null,   -- fixed-window bucket
  hits         int not null default 0,
  primary key (bucket, subject, window_start)
);
alter table rate_limit_counters enable row level security;

create or replace function check_and_bump_rate_limit(
  p_bucket text, p_subject text, p_limit int, p_window_seconds int default 60
) returns boolean                       -- true = allowed, false = over limit
language plpgsql
security definer
set search_path = public
as $$
declare
  v_win  timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into rate_limit_counters (bucket, subject, window_start, hits)
  values (p_bucket, p_subject, v_win, 1)
  on conflict (bucket, subject, window_start) do update
    set hits = rate_limit_counters.hits + 1
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

revoke all on function check_and_bump_rate_limit(text, text, int, int) from public;
grant execute on function check_and_bump_rate_limit(text, text, int, int) to service_role;

-- ----------------------------------------------------------------------------
-- 2. Atomic join-by-code. SECURITY DEFINER; EXECUTE withheld from ALL client
--    roles (revoke from public; grant to service_role ONLY) so only the secret
--    key can call it -> a client with the publishable key cannot invoke it and
--    forge p_user_id. The edge function injects the JWT-verified user id.
-- ----------------------------------------------------------------------------
create or replace function join_league_by_code(p_code text, p_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
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

revoke all on function join_league_by_code(text, text) from public;
grant execute on function join_league_by_code(text, text) to service_role;
