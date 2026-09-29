-- ============================================================================
-- Username write path: server-side format rule on EVERY write + a typed
-- set_username RPC + a batched availability check (mobile 3b-1 "Pick a
-- username" screen).
-- ============================================================================
-- THE GAP: the username format rule ^[A-Za-z0-9_]{3,20}$ was enforced ONLY in
-- the signup trigger (handle_new_user_profile, 20261005000001). The own-row
-- UPDATE/INSERT policies on user_profiles (20251210100000, auth.uid() = id)
-- let any authenticated client write ANY string as its own username — only
-- the partial unique index on LOWER(username) applied. The clients' format
-- checks (login.tsx, (tabs)/profile.tsx, Login.jsx, Profile.jsx) are advisory;
-- a direct PostgREST call skips them.
--
-- WHAT THIS DOES
--   1. CHECK constraint user_profiles_username_format — the universal guard.
--      It applies to every path (own-row policy writes, the RPC below, the
--      signup trigger, service_role), which a function-only fix could not.
--   2. set_username(p_username) — the CALLER's username only (auth.uid(),
--      never a parameter id: join_league_by_code's forge-able p_user_id is
--      the precedent this avoids). Returns 'ok' | 'taken' | 'invalid'.
--   3. check_usernames(p_candidates) — one round trip for the design board's
--      "3 available suggestions" and the live availability check.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   * It does NOT drop or narrow the own-row UPDATE/INSERT policies. They
--     also carry avatar (Profile.jsx, (tabs)/profile.tsx) and expo_push_token
--     (lib/notifications.ts) writes, and four live call sites upsert
--     `username` directly. Forcing username through the RPC would need a
--     column-level REVOKE UPDATE/INSERT (username) plus a per-column GRANT
--     allowlist that silently excludes every future column — and PostgREST
--     upserts SET every payload column including id. With the CHECK, the
--     direct path can no longer write a bad format; the only thing it can do
--     that the RPC cannot is NULL the caller's OWN username, which merely
--     re-triggers their own first-run prompt. Migrating the clients onto
--     set_username (then considering the column lockdown) is a follow-up.
--   * It does NOT enforce the content filter ("Username is not allowed",
--     validateUsername in packages/shared + both apps). That word list is
--     client-side only; any write path bypasses it today, the RPC included.
--   * It does NOT touch the table-wide `SELECT ... TO authenticated USING
--     (true)` policy (a known drift item: it exposes expo_push_token).
--
-- NULL IS LOAD-BEARING: `username IS NULL` drives the 3b-1 first-run prompt
-- (20261005000004). The CHECK allows it; set_username does NOT produce it
-- (NULL / '' return 'invalid') so the RPC never becomes a NULL-ing path.
--
-- VALIDATING, NOT `NOT VALID`: a NOT VALID CHECK is still evaluated against
-- the whole NEW row on every UPDATE, so a grandfathered bad username would
-- make that user's push-token and avatar writes fail with 23514 — a silent
-- partial-state trap. A plain ADD CONSTRAINT validates existing rows and
-- FAILS CLOSED: if any row violates it, this whole migration rolls back
-- cleanly (nothing half-applied). Run the PRE-CHECK below first.
-- Pre-check 2026-09-29: 0 violators of 4 rows; 2 NULL, which the first-run
-- prompt handles. So no data step. Re-run it before the push anyway — prod can
-- change in between, and the constraint still fails closed if it has.
--
-- REGEX PARITY WITH THE SIGNUP TRIGGER (keep them identical): the trigger
-- nulls anything failing this exact pattern BEFORE inserting, so the CHECK
-- can never fire inside it. If the trigger's pattern is ever LOOSENED
-- without this CHECK, the trigger's insert raises check_violation — which
-- its handler does NOT catch (it catches only unique_violation) — and EVERY
-- signup fails with GoTrue's generic "Database error saving new user".
-- Postgres regex bracket ranges match by code point, so [A-Za-z] is ASCII
-- only; without the newline-sensitive flag, `$` is end-of-string only.
--
-- WHY SECURITY DEFINER (both functions): both must stay correct if
-- user_profiles' table-wide SELECT is later narrowed (e.g. to close the
-- expo_push_token exposure). Under INVOKER, a narrowed SELECT would make
-- the 'taken' checks see only the caller-visible rows and report other
-- users' names as available (the unique index would still catch the write,
-- but check_usernames would suggest names that then fail). DEFINER is safe
-- here because of OUTPUT SCOPE: set_username returns only one of three
-- constant strings; check_usernames returns only the caller's OWN input
-- strings echoed back, each paired with one of three constant strings. No
-- column of any other row (id, username, avatar, expo_push_token, ...)
-- reaches the caller — a row's existence is reduced to a status, which an
-- authenticated caller can already learn from the SELECT policy today.
-- CROSS-MIGRATION DEPENDENCY: that last clause is true only while SELECT stays
-- table-wide. Whoever narrows it MUST re-audit these two functions in the
-- same change — by design they keep answering "does name X exist" to every
-- authenticated caller independently of RLS, so a SELECT fix alone would not
-- close that one fact (statuses only; no other column leaks either way).
--
-- ENUMERATION: check_usernames is an oracle for "does this name exist". For
-- `authenticated` that is no new exposure (the SELECT policy returns every
-- username). For `anon` it WOULD be new — anon has matched zero profile rows
-- since 20260728000001, and get_real_user_ids was revoked from anon on the
-- same reasoning — so neither function is granted to anon, even though the
-- pre-auth signup screen would like a live check. Signup collisions are
-- already handled: the trigger stores NULL and the first-run prompt follows.
-- ============================================================================

-- 1. Universal format guard ---------------------------------------------------
alter table public.user_profiles
  add constraint user_profiles_username_format
  check (username is null or username ~ '^[A-Za-z0-9_]{3,20}$');

-- 2. set_username ------------------------------------------------------------
create or replace function public.set_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Unreachable via PostgREST after the grants below (anon cannot execute),
  -- but a service_role / SQL-editor call carries no JWT: fail loudly rather
  -- than write a row keyed on NULL.
  if v_uid is null then
    raise exception 'set_username: not authenticated' using errcode = '42501';
  end if;

  -- Validated exactly as sent — no trim — so what is stored is what was
  -- validated. Clients trim before calling. NULL and '' are 'invalid': the
  -- RPC must never become a NULL-ing path (see header).
  if p_username is null or p_username !~ '^[A-Za-z0-9_]{3,20}$' then
    return 'invalid';
  end if;

  -- Case-insensitive, excluding the caller's own row so re-casing one's own
  -- name ("bob" -> "Bob") and re-setting the same name are both 'ok'.
  -- `username is not null` mirrors the unique index's partial predicate.
  if exists (
    select 1 from public.user_profiles p
     where p.username is not null
       and lower(p.username) = lower(p_username)
       and p.id <> v_uid
  ) then
    return 'taken';
  end if;

  -- The check above races with concurrent callers; the partial unique index
  -- on LOWER(username) is the real arbiter. ON CONFLICT (id) covers the
  -- (post-20261005000004, should-not-happen) account with no profile row;
  -- a name collision raises unique_violation on the OTHER index, caught here.
  begin
    insert into public.user_profiles (id, username)
    values (v_uid, p_username)
    on conflict (id) do update set username = excluded.username;
  exception
    when unique_violation then
      return 'taken';
  end;

  return 'ok';
end;
$$;

comment on function public.set_username(text) is
  'Sets the CALLER''s (auth.uid()) username. Returns exactly one of: '
  '''ok'' | ''taken'' (case-insensitive, other users only) | ''invalid'' '
  '(NULL, '''', or not ^[A-Za-z0-9_]{3,20}$). Content moderation is client-side.';

-- CLAUDE.md: REVOKE FROM PUBLIC alone leaves Supabase's default explicit
-- anon/authenticated grants in place — revoke all three, then grant back.
revoke all on function public.set_username(text) from public, anon, authenticated;
grant execute on function public.set_username(text) to authenticated;

-- 3. check_usernames ---------------------------------------------------------
-- One row per DISTINCT input string (exact, case-sensitive match — "Bob" and
-- "bob" are two rows, both with the same status), in first-occurrence order.
-- A NULL element yields one (NULL, 'invalid') row. The 10-element cap counts
-- the RAW array, duplicates included. NULL or empty array -> zero rows.
-- The caller's own current name reads 'available' (same exclusion as
-- set_username, so the two never disagree).
create or replace function public.check_usernames(p_candidates text[])
returns table (username text, status text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'check_usernames: not authenticated' using errcode = '42501';
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

comment on function public.check_usernames(text[]) is
  'Batched availability for the CALLER: one (username, status) row per distinct '
  'input, status one of ''available'' | ''taken'' | ''invalid''. Max 10 inputs. '
  'Returns only the caller''s own inputs + a status — never other rows'' columns.';

revoke all on function public.check_usernames(text[]) from public, anon, authenticated;
grant execute on function public.check_usernames(text[]) to authenticated;

-- ============================================================================
-- HUMAN ACTION (Giorgio) — from /Users/giorgio/fantasy-stock-deploy, refreshed
-- right before use per CLAUDE.md:
--   git -C /Users/giorgio/fantasy-stock-deploy fetch origin && \
--   git -C /Users/giorgio/fantasy-stock-deploy checkout --detach origin/main
-- ============================================================================
--   PRE-PUSH:
--     1. PRE-CHECK (read-only). `violating` must be 0; any `violator:` rows
--        name what would make the ADD CONSTRAINT fail (it fails closed —
--        a clean rollback — but the migration then needs a NULL-ing step):
--        SELECT 'violating' AS k, count(*)::text AS v FROM public.user_profiles
--          WHERE username IS NOT NULL AND username !~ '^[A-Za-z0-9_]{3,20}$'
--        UNION ALL SELECT 'null_username', count(*)::text FROM public.user_profiles WHERE username IS NULL
--        UNION ALL SELECT 'total', count(*)::text FROM public.user_profiles
--        UNION ALL SELECT 'violator: ' || id::text, coalesce(quote_literal(username), '')
--          FROM public.user_profiles
--          WHERE username IS NOT NULL AND username !~ '^[A-Za-z0-9_]{3,20}$';
--     2. supabase db push --dry-run  (must list ONLY this file as pending)
--     3. supabase db push
--   POST-PUSH (effect, not push output):
--     4. Applied + validated:
--        SELECT conname, convalidated, pg_get_constraintdef(oid) FROM pg_constraint
--         WHERE conrelid = 'public.user_profiles'::regclass
--           AND conname = 'user_profiles_username_format';
--        -> one row, convalidated = true.
--     5. proacl (CLAUDE.md — REVOKE FROM PUBLIC does not clear the default
--        anon/authenticated grants):
--        SELECT proname, proacl, prosecdef, proconfig FROM pg_proc p
--          JOIN pg_namespace n ON n.oid = p.pronamespace
--         WHERE n.nspname = 'public' AND proname IN ('set_username', 'check_usernames');
--        -> each proacl: NO `anon=X`, NO bare `=X` (PUBLIC); `authenticated=X`
--           present; prosecdef = true; proconfig = {"search_path=public, pg_temp"}.
--           `service_role=X` and `postgres=X` (owner) are EXPECTED and benign:
--           Supabase's default privileges grant service_role too, and both
--           functions raise 42501 when auth.uid() is NULL (no JWT `sub`), so a
--           service-role call can never write or look up anything.
--     6. Run docs/security/username-write-path-effect-test.sql (one DO block,
--        rolled back by its final RAISE) -> every line PASS.
--     7. Re-capture docs/architecture/db-snapshot.json (grant + constraint
--        change) and re-run node scripts/gen-architecture.mjs — a SECOND run
--        (the branch's committed map predates the push, so set_username /
--        check_usernames show "ABSENT from prod snapshot" until this runs).
-- ============================================================================
