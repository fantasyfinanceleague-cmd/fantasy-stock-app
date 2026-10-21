-- ============================================================================
-- Account deletion (8/8): heal_account_deletions, the hourly heal's SQL half
-- ============================================================================
-- Plan: docs/plans/2026-10-21-account-deletion.md, "Heal pass" and §Risks
-- "Partial state". The delete-account request can die between any two steps;
-- the ledger (20261125000003) records where. This function does the part of the
-- heal Postgres can do and hands the rest to the edge function (W3), which
-- runs it hourly through runJob with timeout_milliseconds := 180000:
--
-- heal_account_deletions(p_min_age interval default '10 minutes',
--                        p_limit int default 50) -> jsonb
--   1. Every row at 'requested' not touched for p_min_age (the request died
--      after opening the ledger, or the scrub failed): re-run
--      scrub_deleted_manager, each user in its OWN subtransaction, so one
--      failing account cannot block the others (partial-state rule: per
--      participant). A failure is recorded in last_error and listed.
--   2. Returns, for the edge function:
--        auth_delete   every row at 'scrubbed' (after step 1, including the
--                      ones it just scrubbed): call auth.admin.deleteUser (a
--                      404 means already gone), then account_deletion_mark_done,
--                      which checks auth.users itself;
--        apple_pending every row with apple_revoke = 'pending': read the token
--                      with account_deletion_apple_token, revoke, then
--                      account_deletion_apple_revoked.
--   3. Deletes rows at 'done' with no pending revoke that have not changed for
--      7 days (the plan's retention; the ledger holds no name or email).
--   The age gate keeps the heal off a request that is still in flight. A row
--   the edge function cancelled (bad proof) is gone, so it is never healed.
--
-- RETURNS { scrubbed: [uid], scrub_errors: [{user_id, error}], auth_delete:
--   [uid], apple_pending: [uid], purged: n }. Verdict scope (CLAUDE.md): this
--   reports what it did and what is owed; it does not claim any account is
--   done. Only account_deletion_mark_done, after checking auth.users, moves a
--   row to 'done'.
--
-- SERVICE ROLE ONLY, SECURITY DEFINER, search_path pinned.
--
-- PROVISIONAL TIMESTAMP: see 20261125000000.
--
-- POST-PUSH CHECKS (SQL editor):
--   SELECT proacl, prosecdef, proconfig FROM pg_proc WHERE proname = 'heal_account_deletions';
--   -- {postgres=X/postgres,service_role=X/postgres}, t, {"search_path=public, pg_temp"}
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
  v_errors    jsonb := '[]'::jsonb;
  v_auth      jsonb;
  v_apple     jsonb;
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
      perform public.scrub_deleted_manager(r.user_id);
      v_scrubbed := v_scrubbed || jsonb_build_array(to_jsonb(r.user_id));
    exception when others then
      -- The subtransaction rolled the scrub back; record why, outside it.
      get stacked diagnostics v_err = message_text;
      update public.account_deletions
         set last_error = left('heal scrub: ' || v_err, 1000), updated_at = now()
       where user_id = r.user_id;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('user_id', r.user_id, 'error', v_err));
    end;
  end loop;

  -- ---- 2. what the edge function still owes --------------------------------------
  select coalesce(jsonb_agg(d.user_id order by d.updated_at), '[]'::jsonb) into v_auth
    from (select user_id, updated_at from public.account_deletions
           where stage = 'scrubbed' order by updated_at limit p_limit) d;
  select coalesce(jsonb_agg(d.user_id order by d.updated_at), '[]'::jsonb) into v_apple
    from (select user_id, updated_at from public.account_deletions
           where apple_revoke = 'pending' order by updated_at limit p_limit) d;

  -- ---- 3. retention -----------------------------------------------------------------
  delete from public.account_deletions
   where stage = 'done' and apple_revoke <> 'pending' and updated_at < now() - interval '7 days';
  get diagnostics v_purged = row_count;

  return jsonb_build_object(
    'scrubbed', v_scrubbed,
    'scrub_errors', v_errors,
    'auth_delete', v_auth,
    'apple_pending', v_apple,
    'purged', v_purged);
end;
$$;

comment on function public.heal_account_deletions(interval, int) is
  'Account deletion (2026-10-21): re-scrubs stalled ledger rows and lists the auth deletes and Apple revokes '
  'still owed. The hourly heal edge function''s SQL half. Service role only.';

revoke all on function public.heal_account_deletions(interval, int) from public, anon, authenticated;
grant execute on function public.heal_account_deletions(interval, int) to service_role;
