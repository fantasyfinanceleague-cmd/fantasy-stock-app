-- ============================================================================
-- Signup username persistence (ask #6, docs/design/prompts/phase3-plan.md):
-- Home greets every new signup as "Trader" because user_profiles.username
-- ends up NULL. Root cause (traced client -> auth -> table, not assumed):
--
--   Both apps' signup calls `supabase.auth.signUp({ email, password })` with
--   NO metadata, then `user_profiles.upsert({ id, username })` immediately
--   after. With "Confirm email" ON, signUp returns a user but NO session —
--   so that upsert runs as the ANON role, and `auth.uid()` is NULL. It fails
--   the "Users can insert own profile" RLS check (auth.uid() = id). Both
--   clients only special-case 23505 (username taken); every OTHER error,
--   including this RLS refusal, is swallowed (mobile silently, web via
--   console.error only) — CLAUDE.md "success signals are unreliable" in
--   miniature: the failure path exists, but nothing surfaces it, so it read
--   as "it just works" until Home's "Trader" fallback gave it away.
--
--   The username is never sent anywhere else, so existing NULL-username
--   accounts cannot be backfilled from anything the server already has.
--
-- FIX (server-side, so it works regardless of confirm-email / session
-- timing): both client signUp() calls now pass the username as auth
-- metadata (`options.data.username` — see apps/mobile/app/login.tsx,
-- apps/web/src/pages/Login.jsx), the one piece of signup-time state that
-- survives to the server no matter what the client's next network call
-- does. This trigger reads it from auth.users.raw_user_meta_data and
-- creates the profile row itself, inside the SAME transaction GoTrue uses to
-- create the user. Each client's existing upsert is left in place unchanged
-- — it is now a harmless no-op/update in the no-confirmation case, and still
-- fails (as before) under confirm-email, but no longer matters either way.
--
-- MINIMAL BY DESIGN (a failure in this trigger blocks ALL signups with
-- GoTrue's generic "Database error saving new user"):
--   * format validation is inlined, not a call out to another function;
--   * ON CONFLICT (id) DO NOTHING makes a re-fired/duplicate insert (e.g. a
--     race with a client-side upsert that lands first) a no-op, not an
--     error;
--   * a username collision (the partial unique index on LOWER(username)) is
--     caught and retried with NULL rather than raised — signup must never
--     fail because someone else already has that name. A NULL username here
--     joins every pre-existing NULL-username account; both need the 3b-1
--     first-run "pick a username" prompt (tracked there, not fixed here);
--   * every OTHER error (e.g. user_profiles itself being unreachable) is
--     left to propagate — a real failure should stay loud, not be silently
--     swallowed the way the client-side path was.
-- ============================================================================
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_username text := new.raw_user_meta_data ->> 'username';
begin
  -- Same content rule as both clients' pre-submit validation (login.tsx,
  -- Login.jsx): 3-20 chars, letters/digits/underscore only. Anything else
  -- (missing, too short/long, disallowed characters) stores NULL rather than
  -- a value neither client would ever have produced itself.
  if v_username is null or v_username !~ '^[A-Za-z0-9_]{3,20}$' then
    v_username := null;
  end if;

  begin
    insert into public.user_profiles (id, username)
    values (new.id, v_username)
    on conflict (id) do nothing;
  exception
    when unique_violation then
      -- The partial unique index is on LOWER(username) — a DIFFERENT
      -- constraint than the ON CONFLICT (id) target above, so a name
      -- collision raises here rather than being absorbed by it. Retry once
      -- with NULL: a collision must never fail the signup itself.
      insert into public.user_profiles (id, username)
      values (new.id, null)
      on conflict (id) do nothing;
  end;

  return new;
end;
$$;

-- A trigger function's execution isn't gated by a firing role's EXECUTE
-- grant (Postgres invokes it directly as part of the INSERT), so this
-- REVOKE closes off direct RPC-style calls without affecting the trigger.
revoke all on function public.handle_new_user_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- ============================================================================
-- HUMAN ACTION (Giorgio) — from /Users/giorgio/fantasy-stock-deploy per
-- CLAUDE.md.
-- ============================================================================
--   PRE-PUSH:
--     1. Confirm no other trigger already exists on auth.users (a second
--        trigger here is additive and safe, but should be a deliberate
--        choice, not a surprise):
--        SELECT tgname, tgfoid::regproc FROM pg_trigger
--         WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;
--     2. Confirm "Confirm email" in Dashboard -> Authentication -> Providers
--        -> Email, so the effect test's expectations below match reality
--        (this fix is correct either way; only the *symptom* depends on it).
--     3. supabase db push --dry-run, then supabase db push.
--   POST-PUSH (effect, not push output):
--     4. proacl (CLAUDE.md — REVOKE FROM PUBLIC does not clear default
--        anon/authenticated grants):
--        SELECT proname, proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--         WHERE n.nspname = 'public' AND proname = 'handle_new_user_profile';
--        -> proacl must show NO anon=X / authenticated=X entries.
--     5. Run docs/security/game-data-asks-effect-test.sql, section #6 (a
--        rolled-back DO block — no real signups, no real emails sent).
--     6. A REAL signup (mobile or web, an allowlisted test account per the
--        signup gate) must show the chosen username on Home, with no client
--        change beyond this branch's signUp() options.data.username.
--     7. Count existing NULL-username accounts, for the 3b-1 first-run
--        prompt's scope:
--        SELECT count(*) FROM public.user_profiles WHERE username IS NULL;
