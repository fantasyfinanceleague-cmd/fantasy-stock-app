-- ============================================================================
-- GAME-DATA-ASKS EFFECT TEST: asks #5, #6, #7, #9
-- (docs/design/prompts/phase3-plan.md, branch feat/game-data-asks)
--
-- Run in the Supabase SQL editor AFTER `db push` of:
--   20261005000000_league_activity_view.sql   (#5)
--   20261005000001_signup_username_trigger.sql (#6)
--   20261005000002_market_calendar.sql         (#7 — tables/functions only;
--     the cron that KEEPS them fresh is deferred until the edge function is
--     deployed, per supabase/migrations/deferred/README.md)
-- #9 needs no migration — its section below confirms the pre-existing
-- drafts SELECT policy already covers the ask, per the FINDINGS message.
--
-- Shape (same pattern as f10-policy-drop-effect-test.sql / f1-f6 / join-mid-
-- draft): ONE DO block, rolled back at the end by a deliberate RAISE
-- EXCEPTION, so NOTHING persists — including the auth.users / market_calendar
-- fixtures below, which would otherwise be real rows in shared tables.
-- Role/JWT switches use set_config('role', ..., true) / set_config
-- ('request.jwt.claims', ..., true) the way PostgREST does — `role` is a
-- real Postgres GUC (SET ROLE's underlying mechanism), so this is a genuine
-- role switch, not a fake one; `reset role;` between sections un-switches it
-- back to the editor's own privileged connection role.
--
-- auth.users COLUMN LIST: every INSERT below (section #6, and the single
-- one in #9 that backs the trades FK) uses the SAME minimal column set —
-- id, email, created_at, updated_at, aud, role, instance_id, plus
-- raw_user_meta_data where the trigger under test needs to read it. This is
-- the exact set proven to work against the LIVE schema by
-- docs/security/home-summary-display-names-effect-test.sql (ran in prod,
-- ALL PASS) — not a guess. An earlier version of this file used a longer,
-- unverified column list (encrypted_password, confirmation_token,
-- email_change, raw_app_meta_data, ...) that was never actually exercised in
-- prod, because section #9's trades FK failure (below) aborted the whole
-- transaction before section #6 ever ran. Prefer this proven set over adding
-- columns back speculatively.
--
-- LIVE TRIGGER: handle_new_user_profile (20261005000001, now deployed) fires
-- on EVERY auth.users insert below, not just section #6's — including the
-- one that backs the trades FK. Any fixture row this file ALSO inserts into
-- public.user_profiles directly (case J) uses
-- `ON CONFLICT (id) DO UPDATE SET username = ...`, never a bare INSERT, so
-- it cannot collide with the row the trigger already created.
--
-- CAVEAT UNIQUE TO THIS FILE: section #7 temporarily DELETEs and replaces
-- any existing rows in public.market_calendar for 2026-10-01..2026-11-30 and
-- the single row in public.market_calendar_coverage, so it can assert
-- against known fixture dates. This is safe ONLY because the whole file is
-- one transaction that always rolls back (never run a `commit` inside it,
-- and never split this into multiple statements/transactions) — whatever
-- was there before (including nothing, before the cron ever runs) is
-- restored automatically.
--
-- EXPECTED OUTPUT (all PASS after the three migrations are applied):
--   #9  A  member reads N picks incl. 1 SKIP row -> PASS
--   #9  B  non-member reads 0 picks               -> PASS
--   #9  C  anon reads 0 picks                      -> PASS
--   #5  D  member's league_activity: 2 rows, SKIP excluded, casts correct -> PASS
--   #5  E  non-member's league_activity: 0 rows    -> PASS
--   #5  F  anon's league_activity: 0 rows           -> PASS
--   #6  G  valid username persisted                -> PASS
--   #6  H  invalid-format usernames stored NULL     -> PASS
--   #6  I  username collision: second user gets NULL, no error -> PASS
--   #6  J  a subsequent ON CONFLICT (id) upsert for the same id succeeds -> PASS
--   #7  K  regular session mid-day -> 'open'        -> PASS
--   #7  L  pre-market same day -> 'closed'/'pre_market', next_open = today -> PASS
--   #7  M  after-hours Friday -> 'closed'/'after_hours', next_open = Monday -> PASS
--   #7  N  weekend -> 'closed'/'weekend'            -> PASS
--   #7  O  Thanksgiving (a real holiday, not a weekday rule) -> 'closed'/'holiday' -> PASS
--   #7  P  early close (Black-Friday-shaped) after 1pm -> 'closed'/'after_hours' -> PASS
--   #7  Q  DST-crossing next-open (Fri before fall-back -> Mon after) computed correctly -> PASS
--   #7  R  outside coverage -> 'unknown'/'no_coverage' -> PASS
--   #7  S  apply_market_calendar refuses an out-of-window session_date -> PASS
--   #7  U  next-open bounded by covered_through, ignores a stray later row -> PASS
-- ============================================================================
do $$
declare
  -- #9 / #5 fixture
  c_uid   text := gen_random_uuid()::text;  -- fixture commissioner
  m_uid   text := gen_random_uuid()::text;  -- fixture member
  x_uid   text := gen_random_uuid()::text;  -- fixture NON-member (control)
  l       uuid;
  pick1   uuid;
  n       int;
  row_kinds text;
  out     text := E'\n';

  -- #6 fixture
  u_a uuid := gen_random_uuid();
  u_b uuid := gen_random_uuid();
  u_c uuid := gen_random_uuid();
  u_d1 uuid := gen_random_uuid();
  u_d2 uuid := gen_random_uuid();
  u_e uuid := gen_random_uuid();
  uname_a text;
  uname_b text;
  uname_c text;
  uname_d1 text;
  uname_d2 text;

  -- #7 fixture
  d date;
  dow int;
  s record;
begin
  -- ==========================================================================
  -- SECTION #9: draft recap read (no migration — confirms existing RLS)
  -- ==========================================================================
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status)
  values ('__GDA_TEST__', c_uid, 'GDAT-' || gen_random_uuid(), 4, 'in_progress')
  returning id into l;
  insert into public.league_members (league_id, user_id, role)
  values (l, c_uid, 'commissioner'), (l, m_uid, 'member');

  insert into public.drafts (league_id, user_id, symbol, entry_price, quantity, round, pick_number)
  values (l, c_uid, 'AAPL', 123.456, 2.5, 1, 1)
  returning id into pick1;
  insert into public.drafts (league_id, user_id, symbol, entry_price, quantity, round, pick_number)
  values (l, m_uid, 'SKIP', 0, 0, 1, 2);

  -- trades.user_id has a real FK to auth.users(id) (drafts/league_members do
  -- NOT — both are text columns with no FK, per CLAUDE.md's drafts.user_id
  -- text vs trades.user_id uuid note) — a bare gen_random_uuid() here 23503s
  -- (confirmed in prod). c_uid and x_uid never touch an FK-checked column in
  -- this file, so only m_uid needs a real row. handle_new_user_profile
  -- (live) fires on this insert and creates a user_profiles row with
  -- username=NULL (no raw_user_meta_data set) — harmless, since neither #9
  -- nor #5 below reads user_profiles.
  insert into auth.users (id, email, created_at, updated_at, aud, role, instance_id)
  values (m_uid::uuid, 'fixture-m-' || m_uid || '@game-data-asks-test.invalid', now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  insert into public.trades (league_id, user_id, symbol, action, quantity, price, total_value)
  values (l, m_uid::uuid, 'MSFT', 'sell', 1.75, 10.1234, round(1.75 * 10.1234, 2));

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', m_uid, 'role', 'authenticated')::text, true);

  begin
    select count(*) into n from public.drafts where league_id = l;
    if n = 2 then
      out := out || format(E'#9  A  member reads N picks incl. 1 SKIP row -> rows=%s  PASS\n', n);
    else
      out := out || format(E'#9  A  member reads N picks incl. 1 SKIP row -> rows=%s  FAIL\n', n);
    end if;
  exception
    when others then out := out || format(E'#9  A  member reads picks -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', x_uid, 'role', 'authenticated')::text, true);
  begin
    select count(*) into n from public.drafts where league_id = l;
    out := out || case when n = 0
      then E'#9  B  non-member reads 0 picks               -> PASS\n'
      else format(E'#9  B  non-member reads 0 picks               -> rows=%s  FAIL\n', n) end;
  exception
    when others then out := out || format(E'#9  B  non-member reads picks -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{}', true);
  begin
    select count(*) into n from public.drafts where league_id = l;
    out := out || case when n = 0
      then E'#9  C  anon reads 0 picks                      -> PASS\n'
      else format(E'#9  C  anon reads 0 picks                      -> rows=%s  FAIL\n', n) end;
  exception
    when others then out := out || format(E'#9  C  anon reads picks -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  -- ==========================================================================
  -- SECTION #5: league_activity (drafts ∪ trades, SKIP excluded, casts)
  -- ==========================================================================
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', m_uid, 'role', 'authenticated')::text, true);

  begin
    select count(*), string_agg(distinct kind, ',' order by kind) into n, row_kinds
      from public.league_activity where league_id = l;
    if n = 2 and row_kinds = 'draft,trade' then
      out := out || format(E'#5  D  member''s league_activity: 2 rows, SKIP excluded, kinds=%s -> PASS\n', row_kinds);
    else
      out := out || format(E'#5  D  member''s league_activity -> rows=%s kinds=%s  FAIL\n', n, row_kinds);
    end if;
  exception
    when others then out := out || format(E'#5  D  member''s league_activity -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  -- Cast/arithmetic correctness for the draft row (entry_price 123.456 *
  -- quantity 2.5, rounded to 2dp = 308.64) and pg_typeof for the ::text /
  -- ::numeric casts CLAUDE.md requires across drafts (text) / trades (uuid).
  begin
    perform 1 from public.league_activity
      where league_id = l and kind = 'draft' and id = pick1
        and total_value = 308.64
        and pg_typeof(user_id) = 'text'::regtype
        and pg_typeof(quantity) = 'numeric'::regtype;
    if found then
      out := out || E'#5  D2 draft row: total_value=308.64, user_id::text, quantity::numeric -> PASS\n';
    else
      out := out || E'#5  D2 draft row cast/arithmetic check                -> FAIL\n';
    end if;
  exception
    when others then out := out || format(E'#5  D2 draft row cast/arithmetic check -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', x_uid, 'role', 'authenticated')::text, true);
  begin
    select count(*) into n from public.league_activity where league_id = l;
    out := out || case when n = 0
      then E'#5  E  non-member''s league_activity: 0 rows    -> PASS\n'
      else format(E'#5  E  non-member''s league_activity -> rows=%s  FAIL\n', n) end;
  exception
    when others then out := out || format(E'#5  E  non-member league_activity -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{}', true);
  begin
    select count(*) into n from public.league_activity where league_id = l;
    out := out || case when n = 0
      then E'#5  F  anon''s league_activity: 0 rows           -> PASS\n'
      else format(E'#5  F  anon league_activity -> rows=%s  FAIL\n', n) end;
  exception
    when others then out := out || format(E'#5  F  anon league_activity -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  -- reset to the editor's own (bypass-RLS) role for the rest of the fixtures
  reset role;
  perform set_config('request.jwt.claims', null, true);

  -- ==========================================================================
  -- SECTION #6: signup username trigger (handle_new_user_profile)
  -- ==========================================================================
  -- G: valid format persisted.
  begin
    insert into auth.users (id, email, created_at, updated_at, aud, role, instance_id, raw_user_meta_data)
    values (
      u_a, u_a::text || '@game-data-asks-test.invalid', now(), now(), 'authenticated', 'authenticated',
      '00000000-0000-0000-0000-000000000000', jsonb_build_object('username', 'trader_joe')
    );
    select username into uname_a from public.user_profiles where id = u_a;
    out := out || case when uname_a = 'trader_joe'
      then E'#6  G  valid username persisted                -> PASS\n'
      else format(E'#6  G  valid username persisted -> got %s  FAIL\n', coalesce(uname_a, 'NULL')) end;
  exception
    when others then out := out || format(E'#6  G  valid username -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  -- H: invalid-format usernames (a space; too short) both store NULL, no error.
  begin
    insert into auth.users (id, email, created_at, updated_at, aud, role, instance_id, raw_user_meta_data)
    values (
      u_b, u_b::text || '@game-data-asks-test.invalid', now(), now(), 'authenticated', 'authenticated',
      '00000000-0000-0000-0000-000000000000', jsonb_build_object('username', 'has a space')
    );
    insert into auth.users (id, email, created_at, updated_at, aud, role, instance_id, raw_user_meta_data)
    values (
      u_c, u_c::text || '@game-data-asks-test.invalid', now(), now(), 'authenticated', 'authenticated',
      '00000000-0000-0000-0000-000000000000', jsonb_build_object('username', 'ab')
    );
    select username into uname_b from public.user_profiles where id = u_b;
    select username into uname_c from public.user_profiles where id = u_c;
    if uname_b is null and uname_c is null then
      out := out || E'#6  H  invalid-format usernames stored NULL     -> PASS\n';
    else
      out := out || format(E'#6  H  invalid-format -> got %s / %s  FAIL\n', coalesce(uname_b,'NULL'), coalesce(uname_c,'NULL'));
    end if;
  exception
    when others then out := out || format(E'#6  H  invalid-format usernames -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  -- I: two signups requesting the SAME username. First gets it, second is
  -- refused by the partial unique index and the trigger retries with NULL
  -- rather than failing the signup.
  begin
    insert into auth.users (id, email, created_at, updated_at, aud, role, instance_id, raw_user_meta_data)
    values (
      u_d1, u_d1::text || '@game-data-asks-test.invalid', now(), now(), 'authenticated', 'authenticated',
      '00000000-0000-0000-0000-000000000000', jsonb_build_object('username', 'collision_name')
    );
    insert into auth.users (id, email, created_at, updated_at, aud, role, instance_id, raw_user_meta_data)
    values (
      u_d2, u_d2::text || '@game-data-asks-test.invalid', now(), now(), 'authenticated', 'authenticated',
      '00000000-0000-0000-0000-000000000000',
      -- case-insensitive collision, per the unique index on LOWER(username)
      jsonb_build_object('username', 'COLLISION_NAME')
    );
    select username into uname_d1 from public.user_profiles where id = u_d1;
    select username into uname_d2 from public.user_profiles where id = u_d2;
    if uname_d1 = 'collision_name' and uname_d2 is null then
      out := out || E'#6  I  username collision: second user gets NULL, no error -> PASS\n';
    else
      out := out || format(E'#6  I  collision -> first=%s second=%s  FAIL\n', coalesce(uname_d1,'NULL'), coalesce(uname_d2,'NULL'));
    end if;
  exception
    when others then out := out || format(E'#6  I  username collision -> %s %s  CHECK (signup itself must never raise)\n', sqlstate, sqlerrm);
  end;

  -- J: a subsequent ON CONFLICT (id) upsert for an id the trigger already
  -- profiled (e.g. Backend A's own fixture setup, or a client's legacy
  -- upsert) must not error.
  begin
    insert into auth.users (id, email, created_at, updated_at, aud, role, instance_id, raw_user_meta_data)
    values (
      u_e, u_e::text || '@game-data-asks-test.invalid', now(), now(), 'authenticated', 'authenticated',
      '00000000-0000-0000-0000-000000000000', jsonb_build_object('username', 'race_user')
    );
    insert into public.user_profiles (id, username)
    values (u_e, 'race_user')
    on conflict (id) do update set username = excluded.username;
    out := out || E'#6  J  a subsequent ON CONFLICT (id) upsert for the same id succeeds -> PASS\n';
  exception
    when others then out := out || format(E'#6  J  ON CONFLICT compatibility -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  -- ==========================================================================
  -- SECTION #7: market_session_status (fixture calendar 2026-10-01..11-30)
  -- ==========================================================================
  delete from public.market_calendar where session_date between '2026-10-01' and '2026-11-30';
  delete from public.market_calendar_coverage where id = true;

  for d in select generate_series('2026-10-01'::date, '2026-11-30'::date, '1 day')::date loop
    dow := extract(dow from d);
    if dow in (0, 6) then
      continue; -- weekend
    end if;
    if d = '2026-11-26' then
      continue; -- Thanksgiving Day 2026 — a real US market holiday, not a weekday rule
    end if;
    if d = '2026-11-27' then
      insert into public.market_calendar (session_date, open_et, close_et) values (d, '09:30', '13:00'); -- early close
    else
      insert into public.market_calendar (session_date, open_et, close_et) values (d, '09:30', '16:00');
    end if;
  end loop;

  insert into public.market_calendar_coverage (id, covered_from, covered_through, refreshed_at)
  values (true, '2026-10-01', '2026-11-30', now());

  -- K: regular session, mid-day (Wed 2026-10-14 12:00 EDT).
  begin
    select * into s from public.market_session_status('2026-10-14 12:00:00-04'::timestamptz);
    out := out || case when s.status = 'open' and s.reason = 'regular_session'
      then E'#7  K  regular session mid-day -> ''open''        -> PASS\n'
      else format(E'#7  K  regular session mid-day -> status=%s reason=%s  FAIL\n', s.status, s.reason) end;
  exception
    when others then out := out || format(E'#7  K  regular session -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  -- L: pre-market same day (Wed 2026-10-14 08:00 EDT) -> closed/pre_market, next_open = today 09:30.
  begin
    select * into s from public.market_session_status('2026-10-14 08:00:00-04'::timestamptz);
    out := out || case when s.status = 'closed' and s.reason = 'pre_market'
                        and s.next_open_at = '2026-10-14 09:30:00-04'::timestamptz
      then E'#7  L  pre-market same day -> ''closed''/''pre_market'', next_open=today -> PASS\n'
      else format(E'#7  L  pre-market -> status=%s reason=%s next_open=%s  FAIL\n', s.status, s.reason, s.next_open_at) end;
  exception
    when others then out := out || format(E'#7  L  pre-market -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  -- M: after-hours Friday (2026-10-16 18:00 EDT) -> closed/after_hours, next_open = Monday 2026-10-19 09:30 EDT.
  begin
    select * into s from public.market_session_status('2026-10-16 18:00:00-04'::timestamptz);
    out := out || case when s.status = 'closed' and s.reason = 'after_hours'
                        and s.next_open_at = '2026-10-19 09:30:00-04'::timestamptz
      then E'#7  M  after-hours Friday -> ''closed''/''after_hours'', next_open=Monday -> PASS\n'
      else format(E'#7  M  after-hours Friday -> status=%s reason=%s next_open=%s  FAIL\n', s.status, s.reason, s.next_open_at) end;
  exception
    when others then out := out || format(E'#7  M  after-hours Friday -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  -- N: weekend (Sat 2026-10-17 12:00 EDT).
  begin
    select * into s from public.market_session_status('2026-10-17 12:00:00-04'::timestamptz);
    out := out || case when s.status = 'closed' and s.reason = 'weekend'
      then E'#7  N  weekend -> ''closed''/''weekend''            -> PASS\n'
      else format(E'#7  N  weekend -> status=%s reason=%s  FAIL\n', s.status, s.reason) end;
  exception
    when others then out := out || format(E'#7  N  weekend -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  -- O: Thanksgiving (Thu 2026-11-26 12:00 EST) -> holiday, proving this comes
  -- from DATA (the row's absence), not a hard-coded weekday rule (it's a
  -- Thursday, which no weekday rule would ever mark closed).
  begin
    select * into s from public.market_session_status('2026-11-26 12:00:00-05'::timestamptz);
    out := out || case when s.status = 'closed' and s.reason = 'holiday'
                        and s.next_open_at = '2026-11-27 09:30:00-05'::timestamptz
      then E'#7  O  Thanksgiving (data, not a weekday rule) -> ''holiday'' -> PASS\n'
      else format(E'#7  O  Thanksgiving -> status=%s reason=%s next_open=%s  FAIL\n', s.status, s.reason, s.next_open_at) end;
  exception
    when others then out := out || format(E'#7  O  Thanksgiving -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  -- P: early close (Fri 2026-11-27, after the 13:00 close) -> closed/after_hours,
  -- next_open = Monday 2026-11-30 09:30 EST (the window's last covered day).
  begin
    select * into s from public.market_session_status('2026-11-27 14:00:00-05'::timestamptz);
    out := out || case when s.status = 'closed' and s.reason = 'after_hours'
                        and s.next_open_at = '2026-11-30 09:30:00-05'::timestamptz
      then E'#7  P  early close, after 1pm -> ''closed''/''after_hours''   -> PASS\n'
      else format(E'#7  P  early close -> status=%s reason=%s next_open=%s  FAIL\n', s.status, s.reason, s.next_open_at) end;
  exception
    when others then out := out || format(E'#7  P  early close -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  -- Q: DST-crossing next-open. Fri 2026-10-30 after close (EDT, UTC-4) ->
  -- next session Mon 2026-11-02, AFTER the US fall-back (2026-11-01), so its
  -- 09:30 open must resolve in EST (UTC-5). Confirms AT TIME ZONE
  -- 'America/New_York' — not a fixed offset — drives the computation.
  begin
    select * into s from public.market_session_status('2026-10-30 17:00:00-04'::timestamptz);
    out := out || case when s.status = 'closed' and s.reason = 'after_hours'
                        and s.next_open_at = '2026-11-02 09:30:00-05'::timestamptz
                        and s.next_open_et = 'Mon 2026-11-02 09:30'
      then E'#7  Q  DST-crossing next-open (Fri EDT -> Mon EST) correct -> PASS\n'
      else format(E'#7  Q  DST-crossing -> status=%s reason=%s next_open=%s (%s)  FAIL\n', s.status, s.reason, s.next_open_at, s.next_open_et) end;
  exception
    when others then out := out || format(E'#7  Q  DST-crossing next-open -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  -- R: outside the covered window entirely -> 'unknown', never a guess.
  begin
    select * into s from public.market_session_status('2026-12-15 12:00:00-05'::timestamptz);
    out := out || case when s.status = 'unknown' and s.reason = 'no_coverage' and s.coverage_through = '2026-11-30'::date
      then E'#7  R  outside coverage -> ''unknown''/''no_coverage''   -> PASS\n'
      else format(E'#7  R  outside coverage -> status=%s reason=%s coverage_through=%s  FAIL\n', s.status, s.reason, s.coverage_through) end;
  exception
    when others then out := out || format(E'#7  R  outside coverage -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  -- S: apply_market_calendar must refuse (not silently drop, not silently
  -- accept) a session_date outside the requested [p_from, p_through] range —
  -- the DB-layer belt-and-suspenders for the same check plan.ts does before
  -- this RPC is ever called. An exception here IS the pass condition.
  begin
    perform public.apply_market_calendar(
      '2027-02-01'::date, '2027-02-28'::date,
      '[{"session_date":"2027-03-01","open_et":"09:30","close_et":"16:00"}]'::jsonb
    );
    out := out || E'#7  S  apply_market_calendar refuses an out-of-window session_date -> no exception  FAIL\n';
  exception
    when others then out := out || format(E'#7  S  apply_market_calendar refuses an out-of-window session_date -> %s  PASS\n', sqlerrm);
  end;

  -- U: a stray row past covered_through must NEVER be reported as the "next
  -- open" — bounded by v_cov.covered_through in market_session_status, not
  -- just by session_date > today. Inserted directly (bypassing
  -- apply_market_calendar, which would itself refuse this) to prove the
  -- READ side's bound independently of the WRITE side's.
  begin
    insert into public.market_calendar (session_date, open_et, close_et)
    values ('2026-12-25', '09:30', '16:00'); -- outside covered_through = 2026-11-30

    select * into s from public.market_session_status('2026-11-28 12:00:00-05'::timestamptz); -- Sat, within coverage
    out := out || case when s.status = 'closed' and s.reason = 'weekend'
                        and s.next_open_at = '2026-11-30 09:30:00-05'::timestamptz
      then E'#7  U  next-open bounded by covered_through, ignores a stray later row -> PASS\n'
      else format(E'#7  U  next-open bound -> status=%s reason=%s next_open=%s  FAIL\n', s.status, s.reason, s.next_open_at) end;
  exception
    when others then out := out || format(E'#7  U  next-open bound -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  -- Deliberate: rolls back the fixture leagues/drafts/trades, the auth.users
  -- + user_profiles rows, and the market_calendar/coverage replacement above
  -- — and displays `out`.
  raise exception 'GAME-DATA-ASKS EFFECT TEST RESULTS (all rolled back):%', out;
end;
$$;
