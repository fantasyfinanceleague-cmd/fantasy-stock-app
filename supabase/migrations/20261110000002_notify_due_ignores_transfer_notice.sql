-- ============================================================================
-- Commissioner transfer (3/3): draft_order_notify_due ignores
-- commissioner_transferred
-- ============================================================================
-- Like member_left (20261107000006), commissioner_transferred is delivered once,
-- immediately, by the leave-league edge function. draft-order-notify never
-- selects it. A row stranded at 'pending' or stale 'sending' (the function died
-- between the RPC's commit and its settle) would otherwise make the cron's
-- predicate true forever, so the cron would post every tick. It is excluded by
-- kind, not by an allowlist, so PR #94's renewal kinds (which draft-order-notify
-- DOES deliver on that branch) still count.
--
-- The function below is 20261107000006's applied body VERBATIM except the one
-- line marked "20261110000002". CREATE OR REPLACE keeps the ACL; the grants are
-- re-asserted verbatim (service_role only).
--
-- PROVISIONAL TIMESTAMP: see 20261110000000's header.
--
-- POST-PUSH EFFECT CHECK:
--   SELECT proacl, position('commissioner_transferred' in prosrc) > 0 AS ignores
--     FROM pg_proc WHERE proname = 'draft_order_notify_due';
--   -- {postgres=X/postgres,service_role=X/postgres}, t
-- ============================================================================

create or replace function public.draft_order_notify_due()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (
           select 1 from public.leagues l
            where coalesce(l.draft_status, 'not_started') = 'not_started'
              -- inlined _draft_order_is_due: this is SECURITY INVOKER and the
              -- service role may not execute the internal helper
              and l.draft_date is not null
              and now() >= l.draft_date - interval '1 hour'
              -- the MIN_DRAFT_MEMBERS floor, as in _draft_order_sync: without it a
              -- stale under-filled league would keep the cron posting every tick
              and (select count(*) from public.league_members x where x.league_id = l.id) >= 4
              and not exists (select 1 from public.league_draft_order_meta m
                               where m.league_id = l.id and m.state <> 'open')
              -- 20261107000006: a league waiting on its roster reconfirmation can't be finalized
              and not exists (select 1 from public.league_roster_reconfirm r where r.league_id = l.id))
      or exists (
           select 1 from public.league_notifications n
            -- 20261107000006 / 20261110000002: delivered by leave-league, never by this cron
            where n.kind not in ('member_left', 'commissioner_transferred')
              and (n.push_status = 'pending'
                   or (n.push_status = 'sending' and n.push_attempted_at < now() - interval '10 minutes')));
$$;

revoke all on function public.draft_order_notify_due()    from public, anon, authenticated;
grant execute on function public.draft_order_notify_due()    to service_role;
