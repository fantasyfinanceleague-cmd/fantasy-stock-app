-- ============================================================================
-- Account deletion (4/8): the account_deletions ledger and its write functions
-- ============================================================================
-- Plan: docs/plans/2026-10-21-account-deletion.md, "The function:
-- delete-account" steps 2-5 and "Heal pass". Deletion spans three systems
-- (Apple, Postgres, GoTrue) in six steps. The ledger exists so a crash between
-- steps leaves a row the heal pass can finish, never a half-deleted account
-- (CLAUDE.md: a refused or failed step must be RECOVERABLE).
--
-- THE TABLE holds no email and no name: user_id (an opaque uuid once the auth
-- row is gone), the stage, the Apple revoke state, the last error and two
-- timestamps. No foreign key to auth.users: the row must outlive the auth
-- delete it records.
--   stage         'requested' -> 'scrubbed' -> 'done'. Forward only; every
--                 function below refuses to move it backward.
--   apple_revoke  'none' (not an Apple sign-in, or not decided yet) | 'pending'
--                 (the refresh token is in vault, the revoke is owed) | 'done'.
--                 NOT NULL with an explicit 'none': a NULL here would be an
--                 overloaded "not Apple" vs "not known" (CLAUDE.md, "Overloaded
--                 NULLs are type tags").
--
-- ACCESS. RLS on, no policies, and ALL table privileges revoked from public,
-- anon, authenticated AND service_role: even the edge function reaches the
-- ledger only through the functions below, which keep the stage monotonic and
-- check effects. Every function is SECURITY DEFINER, search_path pinned,
-- EXECUTE revoked from public/anon/authenticated (REVOKE FROM PUBLIC alone
-- leaves Supabase's explicit anon/authenticated grants, CLAUDE.md) and granted
-- to service_role only. The edge function passes the JWT-verified user id.
--
-- THE INTERFACE (delete-account, in order; agreed with the Orchestrator):
--   account_deletion_open(uid)           after the proof; upsert 'requested'
--   account_deletion_cancel(uid)         ONLY on a bad_proof found after open
--                                        (the Apple code exchange's 4xx):
--                                        removes a 'requested' row, so the heal
--                                        never finishes a deletion whose proof
--                                        failed
--   account_deletion_set_apple(uid, s)   'none' | 'pending' | 'done', forward only
--   account_deletion_stash_apple_token(uid, token)   Apple down: vault + 'pending'
--   account_deletion_apple_token(uid)    the heal reads it back
--   account_deletion_apple_revoked(uid)  revoke succeeded: vault entry gone, 'done'
--   scrub_deleted_manager(uid)           20261125000005; sets 'scrubbed'
--   account_deletion_mark_done(uid)      after auth.admin.deleteUser; verifies
--                                        auth.users no longer has the id (the
--                                        EFFECT, not GoTrue's status) and sets 'done'
--   account_deletion_fail(uid, error)    records last_error at any step
--   heal_account_deletions(...)          20261125000007; the hourly cron's SQL half
--
-- VAULT. The Apple refresh token is stored as vault secret
-- 'apple_revoke:<user_id>' (the plan's name) and deleted the moment the revoke
-- succeeds. It is a credential for a deleted account: it is never logged, never
-- returned except by account_deletion_apple_token, and the 'pending' state is
-- reported separately, never folded into ok (the plan's verdict-scope rule).
--
-- PROVISIONAL TIMESTAMP: see 20261125000000.
--
-- POST-PUSH CHECKS (SQL editor):
--   SELECT relrowsecurity, relacl FROM pg_class WHERE oid = 'public.account_deletions'::regclass;
--   -- t, {postgres=arwdDxtm/postgres} (owner only; no anon/authenticated/service_role entry)
--   SELECT proname, prosecdef, proconfig, proacl FROM pg_proc
--    WHERE proname LIKE 'account_deletion%' ORDER BY 1;
--   -- every row: t, {"search_path=public, pg_temp"}, {postgres=X/postgres,service_role=X/postgres}
-- ============================================================================

create table if not exists public.account_deletions (
  user_id      uuid primary key,
  requested_at timestamptz not null default now(),
  stage        text not null default 'requested'
               constraint account_deletions_stage_check check (stage in ('requested', 'scrubbed', 'done')),
  apple_revoke text not null default 'none'
               constraint account_deletions_apple_revoke_check check (apple_revoke in ('none', 'pending', 'done')),
  last_error   text
               constraint account_deletions_last_error_len check (last_error is null or length(last_error) <= 1000),
  updated_at   timestamptz not null default now()
);

comment on table public.account_deletions is
  'Account deletion (2026-10-21): one row per deletion in flight or recently done, so every interrupted step is '
  'healable. No email, no name. Service functions only; no client or service_role table access.';

alter table public.account_deletions enable row level security;
revoke all on table public.account_deletions from public, anon, authenticated, service_role;

create index if not exists account_deletions_open_idx
  on public.account_deletions (updated_at) where stage <> 'done' or apple_revoke = 'pending';

-- ---- open ----------------------------------------------------------------
create or replace function public.account_deletion_open(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.account_deletions%rowtype;
begin
  if p_user_id is null then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  select * into v_row from public.account_deletions where user_id = p_user_id for update;
  if not found then
    -- A NEW deletion needs a real account; a retry of an existing one does not
    -- (its auth row may already be gone).
    if not exists (select 1 from auth.users u where u.id = p_user_id) then
      return jsonb_build_object('status', 'refused', 'reason', 'no_such_user');
    end if;
    insert into public.account_deletions (user_id) values (p_user_id)
    on conflict (user_id) do nothing;
    select * into v_row from public.account_deletions where user_id = p_user_id for update;
  else
    -- A retry: keep the stage (never backward) and the first requested_at.
    update public.account_deletions
       set last_error = null, updated_at = now()
     where user_id = p_user_id
    returning * into v_row;
  end if;
  return jsonb_build_object('status', 'open', 'stage', v_row.stage, 'apple_revoke', v_row.apple_revoke);
end;
$$;

-- ---- cancel (bad proof after open) ------------------------------------------
create or replace function public.account_deletion_cancel(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int;
begin
  if p_user_id is null then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  -- Only before anything was scrubbed: once data changed, the deletion must finish.
  delete from public.account_deletions where user_id = p_user_id and stage = 'requested';
  get diagnostics v_n = row_count;
  if v_n > 0 then
    delete from vault.secrets where name = 'apple_revoke:' || p_user_id::text;
  end if;
  return jsonb_build_object('cancelled', v_n > 0);
end;
$$;

-- ---- the Apple revoke state ----------------------------------------------------
create or replace function public.account_deletion_set_apple(p_user_id uuid, p_state text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cur text;
begin
  if p_user_id is null or p_state is null or p_state not in ('none', 'pending', 'done') then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  select apple_revoke into v_cur from public.account_deletions where user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('status', 'refused', 'reason', 'no_ledger');
  end if;
  -- Forward only: none -> pending -> done (none -> done directly is fine).
  if v_cur = p_state then
    return jsonb_build_object('status', 'ok', 'apple_revoke', v_cur);
  end if;
  if (v_cur = 'none' and p_state in ('pending', 'done')) or (v_cur = 'pending' and p_state = 'done') then
    update public.account_deletions set apple_revoke = p_state, updated_at = now() where user_id = p_user_id;
    return jsonb_build_object('status', 'ok', 'apple_revoke', p_state);
  end if;
  return jsonb_build_object('status', 'refused', 'reason', 'backward', 'apple_revoke', v_cur);
end;
$$;

create or replace function public.account_deletion_stash_apple_token(p_user_id uuid, p_refresh_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cur  text;
  v_name text := 'apple_revoke:' || p_user_id::text;
begin
  if p_user_id is null or p_refresh_token is null or btrim(p_refresh_token) = '' then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  select apple_revoke into v_cur from public.account_deletions where user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('status', 'refused', 'reason', 'no_ledger');
  end if;
  if v_cur = 'done' then
    return jsonb_build_object('status', 'refused', 'reason', 'backward', 'apple_revoke', v_cur);
  end if;
  -- One secret per user: replace any earlier token (a retry's fresh exchange).
  delete from vault.secrets where name = v_name;
  perform vault.create_secret(p_refresh_token, v_name, 'Account deletion: Apple refresh token owed a revoke');
  update public.account_deletions set apple_revoke = 'pending', updated_at = now() where user_id = p_user_id;
  return jsonb_build_object('status', 'ok', 'apple_revoke', 'pending');
end;
$$;

create or replace function public.account_deletion_apple_token(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token text;
begin
  if p_user_id is null then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  if not exists (select 1 from public.account_deletions
                  where user_id = p_user_id and apple_revoke = 'pending') then
    return jsonb_build_object('token', null);
  end if;
  select s.decrypted_secret into v_token
    from vault.decrypted_secrets s where s.name = 'apple_revoke:' || p_user_id::text;
  return jsonb_build_object('token', v_token);
end;
$$;

create or replace function public.account_deletion_apple_revoked(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  perform 1 from public.account_deletions where user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('status', 'refused', 'reason', 'no_ledger');
  end if;
  delete from vault.secrets where name = 'apple_revoke:' || p_user_id::text;
  update public.account_deletions set apple_revoke = 'done', updated_at = now() where user_id = p_user_id;
  return jsonb_build_object('status', 'ok', 'apple_revoke', 'done');
end;
$$;

-- ---- errors and the final stage ---------------------------------------------
create or replace function public.account_deletion_fail(p_user_id uuid, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  update public.account_deletions
     set last_error = left(coalesce(nullif(btrim(p_error), ''), 'unknown'), 1000), updated_at = now()
   where user_id = p_user_id;
  return jsonb_build_object('recorded', found);
end;
$$;

create or replace function public.account_deletion_mark_done(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stage text;
begin
  if p_user_id is null then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  select stage into v_stage from public.account_deletions where user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('status', 'refused', 'reason', 'no_ledger');
  end if;
  if v_stage = 'done' then
    return jsonb_build_object('status', 'ok', 'stage', 'done');
  end if;
  if v_stage <> 'scrubbed' then
    -- Never skip the scrub: the auth delete alone would leave the name on every seat.
    return jsonb_build_object('status', 'refused', 'reason', 'not_scrubbed', 'stage', v_stage);
  end if;
  -- The EFFECT, not GoTrue's response (CLAUDE.md: success signals are unreliable).
  if exists (select 1 from auth.users u where u.id = p_user_id) then
    return jsonb_build_object('status', 'refused', 'reason', 'auth_user_exists', 'stage', v_stage);
  end if;
  update public.account_deletions
     set stage = 'done', last_error = null, updated_at = now()
   where user_id = p_user_id;
  return jsonb_build_object('status', 'ok', 'stage', 'done');
end;
$$;

revoke all on function public.account_deletion_open(uuid)                     from public, anon, authenticated;
revoke all on function public.account_deletion_cancel(uuid)                   from public, anon, authenticated;
revoke all on function public.account_deletion_set_apple(uuid, text)          from public, anon, authenticated;
revoke all on function public.account_deletion_stash_apple_token(uuid, text)  from public, anon, authenticated;
revoke all on function public.account_deletion_apple_token(uuid)              from public, anon, authenticated;
revoke all on function public.account_deletion_apple_revoked(uuid)            from public, anon, authenticated;
revoke all on function public.account_deletion_fail(uuid, text)               from public, anon, authenticated;
revoke all on function public.account_deletion_mark_done(uuid)                from public, anon, authenticated;
grant execute on function public.account_deletion_open(uuid)                    to service_role;
grant execute on function public.account_deletion_cancel(uuid)                  to service_role;
grant execute on function public.account_deletion_set_apple(uuid, text)         to service_role;
grant execute on function public.account_deletion_stash_apple_token(uuid, text) to service_role;
grant execute on function public.account_deletion_apple_token(uuid)             to service_role;
grant execute on function public.account_deletion_apple_revoked(uuid)           to service_role;
grant execute on function public.account_deletion_fail(uuid, text)              to service_role;
grant execute on function public.account_deletion_mark_done(uuid)               to service_role;
