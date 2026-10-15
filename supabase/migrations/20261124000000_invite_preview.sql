-- ============================================================================
-- invite-preview: the NO-SESSION league preview behind the invite link
-- ============================================================================
-- Onboarding W3 (plan docs/plans/2026-10-14-onboarding.md; Planner ruling, 2026-10-14).
--
-- A friend who taps an invite link has no session yet, and preview-league is session-only. The web
-- /join page (W5), the app's signed-out arrival screen and "Check your email" all need ONE thing
-- before sign-in: which league, and who invited me. The edge function `invite-preview`
-- (verify_jwt = false) answers with ONLY {name, inviter, reason}; this migration is its database half:
-- the rate-limit state and the lookup, in ONE function so a hit and a miss cost the same round trip.
--
-- WHAT IS DISCLOSED. To any caller holding a valid code: the league's name, the commissioner's username,
-- and (computed in the function, from these facts) whether the league can still be joined. Nothing else:
-- no counts, dates, stakes or ids. The raw facts below leave the DATABASE only to the service role (the
-- edge function), which shapes the answer.
--
-- WHAT IS LIMITED (a guessed code is a bearer capability, so every limit counts MISSES, not only requests):
--   - GLOBAL requests:  600 / minute -> bounds the cheap churn of a valid code hammered from rotating addresses
--   - per-IP requests:   30 / minute
--   - per-IP misses:     10 / hour   -> after that, everything from that IP is refused, valid codes too
--   - GLOBAL misses:    300 / hour   -> after that, everything is refused for everyone. The backstop that
--     bounds enumeration even if the client-IP header the edge function reads can be spoofed; its only cost is
--     that the web falls back to "You're invited to a league" for the rest of the hour.
--   An expired, revoked or malformed code is a MISS exactly like an unknown one.
--
-- WHICH LIMIT TRIPPED is returned as an INTERNAL `limit` key ('ip' | 'miss-ip' | 'miss-all' | 'req-all' |
-- 'contention' | 'salt') next to status 'rate_limited'. The edge function logs a constant line with that key and
-- STRIPS it: the 429 body the client sees is byte-identical for every cause. A tripped global ceiling (or a missing
-- salt) is therefore visible in the function logs instead of looking like a quiet outage.
--
-- GRANTS (CLAUDE.md "Postgres function grants"): REVOKE FROM PUBLIC does NOT remove Supabase's default
-- per-role grants, so the table and the function are revoked from public, anon, authenticated explicitly
-- (and the table from service_role too: only the SECURITY DEFINER function below touches it). Verify with
-- the proacl / relacl queries in docs/security/invite-preview-effect-test.sql, never by assumption.
--
-- State: its own table, never rate_limit_counters (that one is shared with other functions' buckets and has
-- a 2-day purge; this one prunes itself, 2 hours, on every call).
--
-- THE IP IS STORED SALTED, NEVER RAW AND NEVER A BARE HASH. An unsalted SHA-256 of an IPv4 address is not
-- anonymisation (2^32 inputs: every hash can be reversed in minutes). The subject is
-- sha256(salt || ':' || ip), the salt a Vault secret named `invite_preview_ip_salt` that THIS FILE DOES NOT
-- CONTAIN. Creating it is a Giorgio step, once, BEFORE the function is deployed (he generates the value himself):
--     select vault.create_secret('<output of: openssl rand -hex 32>', 'invite_preview_ip_salt',
--                                'salt for hashing client IPs in the invite-preview limiter');
-- FAIL CLOSED: with the secret missing, empty or shorter than 16 characters, invite_preview_lookup answers
-- {status:'rate_limited'} to EVERYONE and touches nothing. It never falls back to an unsalted hash, and the
-- web / apps then show the generic "You're invited to a league" line, so a missing secret degrades the preview
-- instead of weakening the limiter. The salt lookup is its own function (stubbed in the PGlite test, where Vault
-- does not exist); its value is never returned to any client role, and the effect test checks only that it
-- EXISTS, as a boolean.
-- ============================================================================

create table if not exists public.invite_preview_limits (
  subject      text        not null,   -- 'ip:<hash>' | 'miss-ip:<hash>' | 'miss-all'
  window_start timestamptz not null,   -- the minute ('ip:') or the hour ('miss-*') the count belongs to
  hits         int         not null default 0,
  primary key (subject, window_start)
);
create index if not exists invite_preview_limits_window_idx on public.invite_preview_limits (window_start);

alter table public.invite_preview_limits enable row level security;   -- and NO policies: no client role reads or writes it
revoke all on table public.invite_preview_limits from public;
revoke all on table public.invite_preview_limits from anon;
revoke all on table public.invite_preview_limits from authenticated;
revoke all on table public.invite_preview_limits from service_role;

-- The salt, by name. Internal: no client role and not even service_role may call it; invite_preview_lookup
-- (SECURITY DEFINER, same owner) is its only caller.
create or replace function public.invite_preview_ip_salt()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'invite_preview_ip_salt' limit 1
$$;

revoke all on function public.invite_preview_ip_salt() from public;
revoke all on function public.invite_preview_ip_salt() from anon;
revoke all on function public.invite_preview_ip_salt() from authenticated;
revoke all on function public.invite_preview_ip_salt() from service_role;

-- The check-then-bump below runs one caller at a time, through a TRY lock: a caller that cannot take it at once is
-- refused ('contention'), never queued. A blocking lock would let a flood stack up connections (they would all
-- wait on one key and hold PostgREST's pool app-wide); a refusal costs the caller one generic "preview unknown".
-- Its own function so the refusal is testable (PGlite has one session, where an advisory lock is re-entrant).
-- Internal: no client role and not even service_role may call it.
create or replace function public.invite_preview_try_lock()
returns boolean
language sql
volatile
set search_path = public, pg_temp
as $$
  select pg_try_advisory_xact_lock(hashtext('invite_preview_lookup'))
$$;

revoke all on function public.invite_preview_try_lock() from public;
revoke all on function public.invite_preview_try_lock() from anon;
revoke all on function public.invite_preview_try_lock() from authenticated;
revoke all on function public.invite_preview_try_lock() from service_role;

-- lock_timeout = 1s guards a RELATION lock wait: DDL holding ACCESS EXCLUSIVE on leagues, league_members,
-- league_invites or user_profiles (a migration, a VACUUM FULL) would otherwise stall this lookup, with the advisory lock
-- held, until it finished; the lookup fails with 55P03 instead and the edge function answers 500 "unavailable". It does
-- NOT guard the counter row locks (the try-lock above already serialises those).
-- There is NO statement_timeout here, on purpose: a function-level SET applies on entry and never re-arms the timer
-- Postgres armed when the top-level statement (PostgREST's `select invite_preview_lookup(...)`) started, so it would
-- bound nothing. The call's bound is the edge function's abort (invite-preview/lookup.ts, 2 s): CLIENT-SIDE, so
-- PostgREST may not cancel the backend. Do not add ALTER ROLE service_role SET statement_timeout either: it would hit
-- every cron and batch path.
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
       where code = v_code and status = 'pending' and (expires_at is null or expires_at > now());
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
