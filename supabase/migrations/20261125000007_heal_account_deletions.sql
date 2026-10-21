-- ============================================================================
-- Account deletion (8/9): heal_account_deletions + heal_account_deletions_due,
-- the hourly heal's SQL half
-- ============================================================================
-- Plan: docs/plans/2026-10-21-account-deletion.md, "Heal pass" and §Risks
-- "Partial state". The delete-account request can die between any two steps;
-- the ledger (20261125000003) records where. These functions do the part of the
-- heal Postgres can do and hand the rest to the edge function (W3), whose cron
-- (W3's 20261125000010, timeout_milliseconds := 180000, through runJob) calls
-- heal_account_deletions only WHERE heal_account_deletions_due(), so an idle
-- hour makes no HTTP call.
--
-- heal_account_deletions(p_min_age interval default '10 minutes',
--                        p_limit int default 50) -> jsonb
--   1. Every row at 'requested' not touched for p_min_age (the request died
--      after opening the ledger, or the scrub failed): re-run
--      scrub_deleted_manager, each user in its OWN subtransaction, so one
--      failing account cannot block the others (partial-state rule: per
--      participant). A failure is recorded in last_error and listed. Each
--      successful scrub's full result body is returned in scrub_results, so the
--      heal handler can push the succession / left notices it created.
--   2. Apple expiry, through _account_deletion_settle_apple (the vault entry
--      goes with it):
--        - a 'required' row not touched for p_min_age: no request owns it any
--          more and no authorization code can be obtained now -> 'unrevoked';
--        - a 'pending' row whose REQUEST is over 7 days old (requested_at: the
--          retries themselves bump updated_at) -> 'unrevoked'.
--      Their ids are returned in apple_unrevoked.
--   3. Returns what the edge function still owes:
--        auth_delete   every row at 'scrubbed' (after step 1): call
--                      auth.admin.deleteUser (a 404 means already gone), then
--                      account_deletion_mark_done, which checks auth.users itself;
--        apple_pending every 'pending' row still under 7 days: read the token
--                      with account_deletion_apple_token, revoke, then
--                      account_deletion_apple_revoked (or _unrevoked).
--   4. Purge: rows at 'done' whose revoke is settled or never owed (apple_revoke
--      in none / done / unrevoked), unchanged for 7 days. The ledger holds no
--      name or email; this is the plan's retention.
--   The age gate keeps the heal off a request that is still in flight.
--
-- RETURNS { scrubbed: [uid], scrub_results: [scrub body], scrub_errors:
--   [{user_id, error}], auth_delete: [uid], apple_pending: [uid],
--   apple_unrevoked: [uid], purged: n }. Verdict scope (CLAUDE.md): this reports
--   what it did and what is owed; it does not claim any account is done. Only
--   account_deletion_mark_done, after checking auth.users, moves a row to 'done'.
--
-- heal_account_deletions_due() -> boolean: true iff the heal has anything to
--   do with the DEFAULT age: a stalled 'requested' row, any 'scrubbed' row, any
--   'pending' row, a stalled 'required' row, or a purgeable row. It must stay
--   in step with the heal's own predicates (the PGlite suite checks both on
--   the same states).
--
-- SERVICE ROLE ONLY, SECURITY DEFINER, search_path pinned.
--
-- PROVISIONAL TIMESTAMP: see 20261125000000.
--
-- POST-PUSH CHECKS (SQL editor):
--   SELECT proname, proacl, prosecdef, proconfig FROM pg_proc
--    WHERE proname IN ('heal_account_deletions', 'heal_account_deletions_due');
--   -- both {postgres=X/postgres,service_role=X/postgres}, t, {"search_path=public, pg_temp"}
-- ============================================================================

create or replace function public.heal_account_deletions(
  p_min_age interval default '10 minutes',
  p_limit   int      default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scrubbed  jsonb := '[]'::jsonb;
  v_results   jsonb := '[]'::jsonb;
  v_errors    jsonb := '[]'::jsonb;
  v_unrevoked jsonb := '[]'::jsonb;
  v_auth      jsonb;
  v_apple     jsonb;
  v_res       jsonb;
  v_purged    int;
  v_err       text;
  r           record;
begin
  if p_min_age is null or p_min_age < interval '0' or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;

  -- ---- 1. re-scrub stalled 'requested' rows, one subtransaction each -----------
  for r in
    select d.user_id from public.account_deletions d
     where d.stage = 'requested' and d.updated_at < now() - p_min_age
     order by d.updated_at
     limit p_limit
  loop
    begin
      v_res := public.scrub_deleted_manager(r.user_id);
      v_scrubbed := v_scrubbed || jsonb_build_array(to_jsonb(r.user_id));
      v_results  := v_results  || jsonb_build_array(v_res);
    exception when others then
      -- The subtransaction rolled the scrub back; record why, outside it.
      get stacked diagnostics v_err = message_text;
      update public.account_deletions
         set last_error = left('heal scrub: ' || v_err, 1000), updated_at = now()
       where user_id = r.user_id;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('user_id', r.user_id, 'error', v_err));
    end;
  end loop;

  -- ---- 2. Apple expiry --------------------------------------------------------------
  for r in
    select d.user_id from public.account_deletions d
     where (d.apple_revoke = 'required' and d.updated_at < now() - p_min_age)
        or (d.apple_revoke = 'pending' and d.requested_at < now() - interval '7 days')
     order by d.updated_at
     limit p_limit
  loop
    v_res := public._account_deletion_settle_apple(r.user_id, 'unrevoked');
    if v_res ->> 'status' = 'ok' then
      v_unrevoked := v_unrevoked || jsonb_build_array(to_jsonb(r.user_id));
    end if;
  end loop;

  -- ---- 3. what the edge function still owes --------------------------------------
  select coalesce(jsonb_agg(d.user_id order by d.updated_at), '[]'::jsonb) into v_auth
    from (select user_id, updated_at from public.account_deletions
           where stage = 'scrubbed' order by updated_at limit p_limit) d;
  select coalesce(jsonb_agg(d.user_id order by d.updated_at), '[]'::jsonb) into v_apple
    from (select user_id, updated_at from public.account_deletions
           where apple_revoke = 'pending' and requested_at >= now() - interval '7 days'
           order by updated_at limit p_limit) d;

  -- ---- 4. retention -----------------------------------------------------------------
  delete from public.account_deletions
   where stage = 'done' and apple_revoke in ('none', 'done', 'unrevoked')
     and updated_at < now() - interval '7 days';
  get diagnostics v_purged = row_count;

  return jsonb_build_object(
    'scrubbed', v_scrubbed,
    'scrub_results', v_results,
    'scrub_errors', v_errors,
    'auth_delete', v_auth,
    'apple_pending', v_apple,
    'apple_unrevoked', v_unrevoked,
    'purged', v_purged);
end;
$$;

comment on function public.heal_account_deletions(interval, int) is
  'Account deletion (2026-10-21): re-scrubs stalled ledger rows, expires unsettled Apple revokes, purges old done '
  'rows, and lists the auth deletes and Apple revokes still owed. The hourly heal''s SQL half. Service role only.';

create or replace function public.heal_account_deletions_due()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.account_deletions d
     where (d.stage = 'requested' and d.updated_at < now() - interval '10 minutes')
        or d.stage = 'scrubbed'
        or d.apple_revoke = 'pending'
        or (d.apple_revoke = 'required' and d.updated_at < now() - interval '10 minutes')
        or (d.stage = 'done' and d.apple_revoke in ('none', 'done', 'unrevoked')
            and d.updated_at < now() - interval '7 days'))
$$;

comment on function public.heal_account_deletions_due() is
  'Account deletion (2026-10-21): does the hourly heal have anything to do? The cron''s WHERE, so an idle hour '
  'makes no HTTP call. Service role only.';

revoke all on function public.heal_account_deletions(interval, int) from public, anon, authenticated;
revoke all on function public.heal_account_deletions_due()          from public, anon, authenticated;
grant execute on function public.heal_account_deletions(interval, int) to service_role;
grant execute on function public.heal_account_deletions_due()          to service_role;
