-- ============================================================================
-- Market session status (ask #7, docs/design/prompts/phase3-plan.md): open /
-- closed / holiday, plus the next open time in ET. Holidays must come from
-- DATA, not a hard-coded weekday rule — a weekday rule cannot know
-- Thanksgiving, a half-day, or a rule change, and this project already calls
-- Alpaca server-side for exactly this calendar (snapshot-week-start's
-- isMarketOpenToday).
--
-- TABLE, REFRESHED DAILY, NOT AN ON-DEMAND CALL PER CLIENT: every screen
-- that shows session status would otherwise spend an Alpaca round trip, and
-- a transient Alpaca outage would flip every client to "unknown" at once.
-- With a ~97-day cached window (supabase/functions/refresh-market-calendar),
-- one failed refresh changes nothing for clients until the window runs out —
-- the same "a failure changes nothing" shape as enrich-symbols' unpriced
-- backlog, not a live dependency on Alpaca's uptime.
--
-- EXPLICIT COVERAGE, NOT "missing row = holiday": CLAUDE.md's overloaded-NULL
-- lesson has a table-shaped twin here — a missing session_date is ambiguous
-- on its own (holiday? weekend? never fetched?). market_calendar_coverage
-- states the exact [covered_from, covered_through] window the LAST
-- successful refresh vouches for. Inside it, a missing weekday is a holiday
-- (comparing against the row's absence is now meaningful); outside it, the
-- caller gets an explicit 'unknown' rather than a fabricated status —
-- distinguishing "the market is closed" from "we don't know" is the entire
-- point of the ask (a stale Alpaca key must never read as "market closed",
-- CLAUDE.md "success signals" #1).
-- ============================================================================

create table if not exists public.market_calendar (
  session_date date primary key,
  open_et      time not null,
  close_et     time not null,
  constraint market_calendar_open_before_close check (open_et < close_et)
);
comment on table public.market_calendar is
  'One row per US equity trading session (Alpaca /v2/calendar). A date '
  'inside market_calendar_coverage''s window with NO row here is a holiday '
  'or weekend, not missing data. open_et/close_et are ET wall-clock times '
  '(no timezone; combine with session_date and convert via AT TIME ZONE '
  '''America/New_York'' for DST-correct instants).';

create table if not exists public.market_calendar_coverage (
  -- Constant-TRUE id, same single-row pattern as public.app_config: the
  -- table holds at most one row.
  id              boolean     primary key default true check (id),
  covered_from    date        not null,
  covered_through date        not null,
  refreshed_at    timestamptz not null default now(),
  constraint market_calendar_coverage_range check (covered_through >= covered_from)
);
comment on table public.market_calendar_coverage is
  'The exact date range the last successful refresh-market-calendar run '
  'vouches for. Replaced wholesale each refresh (not merged/widened) — this '
  'row states what THIS refresh covers, not a historical union, so a gap '
  'from a missed refresh is never masked as coverage.';

alter table public.market_calendar          enable row level security;
alter table public.market_calendar_coverage enable row level security;

-- Non-sensitive market data; readable by any logged-in client the same way
-- symbols/week_snapshots are. anon gets nothing (writes are SECURITY DEFINER
-- / service_role only — see apply_market_calendar below).
create policy market_calendar_select_authenticated
  on public.market_calendar for select
  to authenticated
  using (true);

create policy market_calendar_coverage_select_authenticated
  on public.market_calendar_coverage for select
  to authenticated
  using (true);

-- Explicit, not assumed (same discipline as league_activity in the sibling
-- migration): revoke from authenticated too, THEN grant back only SELECT —
-- RLS already default-denies writes here (no INSERT/UPDATE/DELETE policy for
-- any role), but the ACL layer should say the same thing on its own, not
-- rely on RLS alone to prove it closed.
revoke all on public.market_calendar          from public, anon, authenticated;
revoke all on public.market_calendar_coverage from public, anon, authenticated;
grant select on public.market_calendar          to authenticated;
grant select on public.market_calendar_coverage to authenticated;

-- ============================================================================
-- apply_market_calendar: the ONLY write path. Replaces the stated window in
-- one transaction so a client can never observe a torn state (some of the
-- new window's dates written, coverage not yet updated to match, or vice
-- versa). SECURITY DEFINER so the cron function's service-role caller can
-- write without needing table owner privileges; search_path pinned per
-- CLAUDE.md's definer-footgun note (unqualified names must not resolve via
-- a caller-controlled path). Validation of the CONTENT (is this a plausible
-- calendar, not an error page or a truncated response) happens in the pure
-- planner supabase/functions/refresh-market-calendar/plan.ts BEFORE this is
-- ever called — this function trusts its caller's shape but still refuses an
-- inverted range outright.
-- ============================================================================
create or replace function public.apply_market_calendar(
  p_from     date,
  p_through  date,
  p_sessions jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_from is null or p_through is null or p_through < p_from then
    raise exception 'apply_market_calendar: invalid range % .. %', p_from, p_through;
  end if;

  -- Defense in depth (belt-and-suspenders with plan.ts's own window check):
  -- this DELETE only ever targets THIS call's [p_from, p_through] slice, so
  -- an out-of-window row that somehow got this far would never be cleaned up
  -- by any future call. Refuse the WHOLE write rather than silently drop or
  -- silently accept it — a caller bug here should be loud, not quietly
  -- absorbed.
  if exists (
    select 1
      from jsonb_array_elements(coalesce(p_sessions, '[]'::jsonb)) as elem
     where (elem->>'session_date')::date < p_from
        or (elem->>'session_date')::date > p_through
  ) then
    raise exception 'apply_market_calendar: a session_date falls outside % .. %', p_from, p_through;
  end if;

  delete from public.market_calendar
   where session_date >= p_from and session_date <= p_through;

  insert into public.market_calendar (session_date, open_et, close_et)
  select
    (elem->>'session_date')::date,
    (elem->>'open_et')::time,
    (elem->>'close_et')::time
  from jsonb_array_elements(coalesce(p_sessions, '[]'::jsonb)) as elem;

  insert into public.market_calendar_coverage (id, covered_from, covered_through, refreshed_at)
  values (true, p_from, p_through, now())
  on conflict (id) do update
    set covered_from    = excluded.covered_from,
        covered_through = excluded.covered_through,
        refreshed_at    = excluded.refreshed_at;
end;
$$;

revoke all on function public.apply_market_calendar(date, date, jsonb) from public, anon, authenticated;
grant execute on function public.apply_market_calendar(date, date, jsonb) to service_role;

-- ============================================================================
-- market_session_status: the read path. SECURITY INVOKER (default, stated
-- explicitly) — it runs as the CALLING role, relying on the SELECT policies
-- above, not on any elevated privilege. STABLE (not VOLATILE): same
-- arguments within one statement always return the same result, which lets
-- the planner treat repeated calls cheaply (e.g. from the #1 Home-summary
-- RPC joining this in).
--
-- p_now defaults to now() but takes an explicit argument so the effect test
-- can assert fixed instants (Friday after close, a holiday, an early close,
-- a DST-boundary date) without waiting for the calendar.
-- ============================================================================
create or replace function public.market_session_status(p_now timestamptz default now())
returns table (
  status            text,             -- 'open' | 'closed' | 'unknown'
  reason            text,             -- 'regular_session' | 'pre_market' |
                                       -- 'after_hours' | 'weekend' |
                                       -- 'holiday' | 'no_coverage'
  session_open_at   timestamptz,      -- set only when status = 'open'
  session_close_at  timestamptz,      -- set only when status = 'open'
  next_open_at      timestamptz,      -- set whenever status != 'open'
  next_open_et      text,             -- e.g. 'Mon 2026-10-05 09:30'
  coverage_through  date,             -- so a caller nearing the edge of the
                                       -- cached window can log/alert on it
  as_of             timestamptz
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_cov         public.market_calendar_coverage%rowtype;
  v_cov_found   boolean;
  v_today_et    date;
  v_today       public.market_calendar%rowtype;
  v_today_found boolean;
  v_open_ts     timestamptz;
  v_close_ts    timestamptz;
  v_next        public.market_calendar%rowtype;
  v_next_open   timestamptz;
  v_dow         int;
begin
  select * into v_cov from public.market_calendar_coverage where id = true;
  v_cov_found := found;

  v_today_et := (p_now at time zone 'America/New_York')::date;

  -- Outside the last refresh's stated window: an explicit 'unknown', never a
  -- guess. This is the branch that keeps a stale Alpaca key or a missed cron
  -- run from ever reading as "closed" (CLAUDE.md "success signals" #1).
  if not v_cov_found or v_today_et < v_cov.covered_from or v_today_et > v_cov.covered_through then
    return query select
      'unknown'::text, 'no_coverage'::text,
      null::timestamptz, null::timestamptz,
      null::timestamptz, null::text,
      v_cov.covered_through, p_now;
    return;
  end if;

  select * into v_today from public.market_calendar where session_date = v_today_et;
  v_today_found := found;

  if v_today_found then
    v_open_ts  := (v_today.session_date + v_today.open_et)  at time zone 'America/New_York';
    v_close_ts := (v_today.session_date + v_today.close_et) at time zone 'America/New_York';

    if p_now >= v_open_ts and p_now <= v_close_ts then
      return query select
        'open'::text, 'regular_session'::text,
        v_open_ts, v_close_ts,
        null::timestamptz, null::text,
        v_cov.covered_through, p_now;
      return;
    end if;
  end if;

  -- Closed: today's own (not-yet-open) session if pre-market, else the
  -- earliest later session_date within the covered window.
  if v_today_found and p_now < v_open_ts then
    v_next_open := v_open_ts;
  else
    -- Bounded by covered_through: a row cannot be reported as a vouched-for
    -- "next open" beyond what THIS refresh actually covers, even if a stray
    -- row somehow existed past the edge of the window (belt-and-suspenders
    -- with apply_market_calendar's own window check above it).
    select * into v_next from public.market_calendar
     where session_date > v_today_et
       and session_date <= v_cov.covered_through
     order by session_date asc
     limit 1;
    if found then
      v_next_open := (v_next.session_date + v_next.open_et) at time zone 'America/New_York';
    else
      -- No later session inside the covered window at all — the window is
      -- either exhausted or genuinely has no more sessions to report yet.
      -- Left null rather than guessing; coverage_through tells the caller
      -- how stale the window is.
      v_next_open := null;
    end if;
  end if;

  v_dow := extract(dow from v_today_et);

  return query select
    'closed'::text,
    case
      when v_today_found and p_now < v_open_ts  then 'pre_market'
      when v_today_found and p_now > v_close_ts then 'after_hours'
      when v_dow in (0, 6)                      then 'weekend'
      else                                            'holiday'
    end,
    null::timestamptz, null::timestamptz,
    v_next_open,
    -- 'Dy' is locale-dependent (this server's locale gives English 3-letter
    -- abbreviations, e.g. 'Mon'); fine for this project's single-locale
    -- deployment, worth re-checking if this is ever ported elsewhere.
    case when v_next_open is not null
      then to_char(v_next_open at time zone 'America/New_York', 'Dy YYYY-MM-DD HH24:MI')
      else null
    end,
    v_cov.covered_through, p_now;
end;
$$;

revoke all on function public.market_session_status(timestamptz) from public, anon;
grant execute on function public.market_session_status(timestamptz) to authenticated;

-- ============================================================================
-- HUMAN ACTION (Giorgio) — from /Users/giorgio/fantasy-stock-deploy per
-- CLAUDE.md. This migration alone leaves both tables EMPTY (no rows, no
-- coverage) until refresh-market-calendar is deployed and run at least once
-- — market_session_status will correctly report 'unknown' until then. The
-- cron that keeps it fresh is DEFERRED (see
-- supabase/migrations/deferred/README.md) until that function is deployed.
-- ============================================================================
--   PRE-PUSH: supabase db push --dry-run, then supabase db push.
--   POST-PUSH (effect, not push output):
--     1. proacl / relacl (CLAUDE.md — REVOKE FROM PUBLIC does not clear
--        default anon/authenticated grants):
--        SELECT proname, proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--         WHERE n.nspname = 'public' AND proname IN ('apply_market_calendar', 'market_session_status');
--        -> apply_market_calendar: service_role only, no anon/authenticated.
--        -> market_session_status: authenticated only, no anon.
--        SELECT tablename, policyname, roles FROM pg_policies
--         WHERE schemaname = 'public' AND tablename IN ('market_calendar', 'market_calendar_coverage');
--        SELECT relname, relacl FROM pg_class
--         WHERE relnamespace = 'public'::regnamespace AND relname IN ('market_calendar', 'market_calendar_coverage');
--        -> relacl must show authenticated=r/<owner> only, no anon=... entry.
--     2. Deploy supabase/functions/refresh-market-calendar
--        (--project-ref haiaaifjcclsvmkfqgmd), verify per its own README/
--        comments, run it once manually (curl with the cron apikey header,
--        never a real key printed to a log), then:
--        SELECT covered_from, covered_through, refreshed_at FROM public.market_calendar_coverage;
--        SELECT count(*) FROM public.market_calendar;
--     3. Run docs/security/game-data-asks-effect-test.sql, section #7.
--     4. Only THEN promote supabase/migrations/deferred/20261005000003_schedule_refresh_market_calendar.sql
--        per that directory's README.
