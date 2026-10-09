-- Scraping hardening (audit items #6, #9, #10, #13, #14). Ruling 2026-10-08:
-- "I don't want people to be able to scrape anything and the more secure and
-- locked down this can be the better." No player-visible change; each section
-- names its callers and why they are unaffected.
--
-- 1. Trigger functions lose anon / PUBLIC / authenticated EXECUTE.
--    enforce_symbol_category_cap, symbols_touch_updated_at and
--    update_user_profiles_updated_at carry Supabase's default '=X', anon=X and
--    authenticated=X (db-snapshot 2026-10-07). Nothing readable leaks (a
--    trigger function refuses a direct call), but they are needless RPC
--    surface. EXECUTE is checked when a trigger is CREATED, not when it fires,
--    so every trigger keeps working (the PGlite test fires one as authenticated).
--
-- 2. check_usernames gets a per-user rate limit (two windows). It is a
--    username-exists oracle (10 names per call); with no limit any signed-in
--    account could walk a dictionary. The picker (UsernamePicker.tsx) debounces
--    350 ms and checks one candidate per settle plus one batch of up to 9
--    suggestions: a real session is a few dozen calls over a couple of minutes.
--    60 per minute and 600 per hour sit far above that and cap a scraper at
--    6,000 names an hour. Over the limit it raises SQLSTATE PT429 (PostgREST:
--    HTTP 429); usernameApi.ts already turns any error into its "check failed"
--    state. The limiter is check_and_bump_rate_limit (service_role-only); this
--    SECURITY DEFINER function, owned by postgres, may call it. The function
--    becomes VOLATILE because it now writes a counter row; otherwise the body
--    and grants are unchanged.
--
-- 3. get_real_user_ids answers only for users who share a league with the
--    caller (or the caller). Its one caller, web DraftPage, passes the league's
--    own member ids, so its answer is unchanged; a probe with arbitrary UUIDs
--    learns nothing. Signature, return shape (NULL when none) and grants kept.
--
-- 4. symbol_category_overrides.justification (internal curation rationale) is
--    no longer readable by authenticated. A column REVOKE is a no-op while the
--    role holds table-wide SELECT, so the table grant is replaced by a column
--    grant on (id, symbol, category_id, created_at). Clients select only
--    symbol and category_id (mobile + web categoryData) and filter on symbol;
--    edge functions and draft_feasibility_pool read as service_role.
--
-- 5. splits becomes service_role only: no client or function reads it (the
--    architecture map lists it as dead code). The authenticated SELECT policy
--    is dropped and anon / authenticated lose every table privilege.
--
-- POST-PUSH CHECKS (SQL editor; submit each on its own):
--   -- 1. EXPECT, for each of the three: postgres + service_role only.
--   SELECT proname, proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND proname IN
--      ('enforce_symbol_category_cap','symbols_touch_updated_at','update_user_profiles_updated_at');
--   -- 2. EXPECT provolatile = 'v' and the same proacl as before
--   --    (authenticated, service_role, postgres).
--   SELECT provolatile, proacl FROM pg_proc WHERE proname = 'check_usernames';
--   -- 4. EXPECT: f | t | t
--   SELECT has_column_privilege('authenticated','public.symbol_category_overrides','justification','SELECT'),
--          has_column_privilege('authenticated','public.symbol_category_overrides','symbol','SELECT'),
--          has_column_privilege('authenticated','public.symbol_category_overrides','category_id','SELECT');
--   -- 5. EXPECT: f | f | 0 rows from pg_policies
--   SELECT has_table_privilege('authenticated','public.splits','SELECT'),
--          has_table_privilege('anon','public.splits','SELECT');
--   SELECT policyname FROM pg_policies WHERE tablename = 'splits';
--   -- Effect, in the app: the username picker still checks names; the draft
--   -- room's category badges still load (they read symbol_category_overrides).

-- 1 --------------------------------------------------------------------------
revoke execute on function public.enforce_symbol_category_cap() from public, anon, authenticated;
revoke execute on function public.symbols_touch_updated_at() from public, anon, authenticated;
revoke execute on function public.update_user_profiles_updated_at() from public, anon, authenticated;

-- 2 --------------------------------------------------------------------------
create or replace function public.check_usernames(p_candidates text[])
returns table (username text, status text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_minute_ok boolean;
  v_hour_ok boolean;
begin
  if v_uid is null then
    raise exception 'check_usernames: not authenticated' using errcode = '42501';
  end if;

  -- Two windows, BOTH bumped on every call (separate statements, so neither
  -- is short-circuited away); either one over its limit refuses.
  v_minute_ok := public.check_and_bump_rate_limit('check-usernames', 'user:' || v_uid::text, 60, 60);
  v_hour_ok := public.check_and_bump_rate_limit('check-usernames-hour', 'user:' || v_uid::text, 600, 3600);
  if v_minute_ok is not true or v_hour_ok is not true then
    raise exception 'check_usernames: rate limited' using errcode = 'PT429';
  end if;

  if p_candidates is null or cardinality(p_candidates) = 0 then
    return;
  end if;

  if cardinality(p_candidates) > 10 then
    raise exception 'check_usernames: at most 10 candidates (got %)', cardinality(p_candidates)
      using errcode = '22023';
  end if;

  -- Every reference is qualified: the OUT columns `username`/`status` are
  -- plpgsql variables in this body and would otherwise be ambiguous with
  -- user_profiles.username.
  return query
    select c.candidate,
           case
             when c.candidate is null or c.candidate !~ '^[A-Za-z0-9_]{3,20}$' then 'invalid'
             when exists (
               select 1 from public.user_profiles p
                where p.username is not null
                  and lower(p.username) = lower(c.candidate)
                  and p.id <> v_uid
             ) then 'taken'
             else 'available'
           end
      from (
        select distinct on (x.candidate) x.candidate, x.ord
          from unnest(p_candidates) with ordinality as x(candidate, ord)
         order by x.candidate, x.ord
      ) c
     order by c.ord;
end;
$$;

revoke all on function public.check_usernames(text[]) from public, anon, authenticated;
grant execute on function public.check_usernames(text[]) to authenticated;

-- 3 --------------------------------------------------------------------------
create or replace function public.get_real_user_ids(user_ids text[])
returns text[]
language sql
security definer
set search_path = public
as $$
  select array_agg(u.id::text)
    from auth.users u
   where u.id::text = any(user_ids)
     and (
       u.id = auth.uid()
       or exists (
         select 1
           from public.league_members mine
           join public.league_members theirs on theirs.league_id = mine.league_id
          where mine.user_id::text = auth.uid()::text
            and theirs.user_id::text = u.id::text
       )
     );
$$;

revoke all on function public.get_real_user_ids(text[]) from public, anon;
grant execute on function public.get_real_user_ids(text[]) to authenticated;

-- 4 --------------------------------------------------------------------------
revoke select on table public.symbol_category_overrides from authenticated;
revoke all on table public.symbol_category_overrides from anon;
grant select (id, symbol, category_id, created_at) on table public.symbol_category_overrides to authenticated;

-- 5 --------------------------------------------------------------------------
drop policy if exists "splits_select_authenticated" on public.splits;
revoke all on table public.splits from public, anon, authenticated;
