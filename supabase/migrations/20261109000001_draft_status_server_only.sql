-- ============================================================================
-- draft_status is server-only (draft auto-start, 2026-10-06; Orchestrator
-- decision 5 = YES, a security fix). Plan: docs/migrations/DRAFT_AUTO_START_PLAN.md §1.7.
--
-- PROVISIONAL TIMESTAMP (20261109000000-09 range): re-stamp at release if
-- anything later is applied first.
--
-- THE HOLE: [I2a] leagues_update_commissioner lets the commissioner PATCH any
-- column, and 20261104000000's transition table still ALLOWED a user session
-- not_started -> in_progress / completed. So a commissioner could start a draft
-- directly, before draft_date, skipping every check draft-control /
-- start_league_draft enforce (members, stake mode, playoff spots, feasibility,
-- #126's reconfirm is the one gate that would still fire). [I2b] similarly let
-- any member flip in_progress -> completed. With auto-start, no user session has
-- a legitimate reason to write draft_status at all.
--
-- THE FIX, in #123's own function so the transition rule lives in ONE place
-- (no second trigger racing it for the same column): rule (1) of
-- enforce_league_rules_frozen_after_draft_start becomes "a user session may not
-- change draft_status". The body is otherwise VERBATIM from 20261104000000
-- (diff it); SECURITY INVOKER, search_path and the trigger are unchanged.
-- CREATE OR REPLACE keeps privileges, the REVOKEs are re-issued anyway.
-- Consequence, deliberate: rule (2)'s completion-stamp carve-out (dates NULL ->
-- value in the in_progress -> completed UPDATE) is now unreachable for user
-- sessions; it still describes the shape and costs nothing to keep verbatim.
--
-- PLUS an INSERT guard (new trigger): a user session may only create a league
-- in 'not_started' (the column default). Otherwise a client could INSERT a
-- league already in_progress — the AFTER UPDATE order-lock trigger never fires
-- on an INSERT, so that league would have no draft order at all.
--
-- WHO WRITES draft_status TODAY (grep 2026-10-06): draft-control start and the
-- auto-start sweep (service role, start_league_draft); finalize_league_draft
-- (service role); #94's finalize/renew paths (service role / INSERT
-- 'not_started'). Clients: apps/mobile create-league INSERTs 'not_started'
-- (allowed); league-settings never sends draft_status; the paused web app's
-- DraftPage.jsx handleStartDraft flip and member completeDraft are refused from
-- here on (web is APP_PAUSED; re-route them through draft-control before any
-- unpause). Service role, cron and the SQL editor (auth.uid() IS NULL) are
-- exempt, as in every guard here.
--
-- PLUS the DRAFT TIME guard (Giorgio, 2026-10-06, decisions 4 + 5) and the
-- reschedule trigger; see the section at the bottom.
-- ============================================================================

create or replace function public.enforce_league_rules_frozen_after_draft_start()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_changed text[];
begin
  if auth.uid() is null then
    return new;
  end if;

  -- (1) draft_status is SERVER-ONLY (20261109000001, draft auto-start). A user
  -- session may not change it at all: the server starts the draft at
  -- draft_date (start_league_draft) and finalizes it (finalize_league_draft),
  -- both on the service role, which returned above. This replaces
  -- 20261104000000's transition table, whose not_started -> in_progress /
  -- completed rows let a commissioner start a draft over PostgREST ([I2a])
  -- BEFORE draft_date with no checks at all. Backward moves stay refused (the
  -- rewind hole), now with every other move.
  if new.draft_status is distinct from old.draft_status then
    raise exception 'draft_status_server_only: the draft starts and finishes on its own; the draft status cannot be changed directly (% to %)',
      coalesce(old.draft_status, 'NULL'), coalesce(new.draft_status, 'NULL')
      using errcode = '42501';
  end if;

  -- (2) frozen unless the league was EXACTLY not_started before this UPDATE.
  if old.draft_status is not distinct from 'not_started' then
    return new;
  end if;

  v_changed := array_remove(array[
    case when new.stake_mode        is distinct from old.stake_mode        then 'stake_mode' end,
    case when new.budget_amount     is distinct from old.budget_amount     then 'budget_amount' end,
    case when new.notional_per_slot is distinct from old.notional_per_slot then 'notional_per_slot' end,
    case when new.num_rounds        is distinct from old.num_rounds        then 'num_rounds' end,
    case when new.allow_undraftable is distinct from old.allow_undraftable then 'allow_undraftable' end,
    case when new.num_weeks         is distinct from old.num_weeks         then 'num_weeks' end,
    case when new.duration_days     is distinct from old.duration_days     then 'duration_days' end,
    case when new.league_type       is distinct from old.league_type       then 'league_type' end,
    case when new.num_participants  is distinct from old.num_participants  then 'num_participants' end,
    case when new.season_status     is distinct from old.season_status     then 'season_status' end,
    case when new.current_week      is distinct from old.current_week      then 'current_week' end,
    case when new.current_season_id is distinct from old.current_season_id then 'current_season_id' end,
    case when new.commissioner_id   is distinct from old.commissioner_id   then 'commissioner_id' end,
    case when new.budget_mode       is distinct from old.budget_mode       then 'budget_mode' end,
    -- F1's completion stamp: NULL -> value, only in the in_progress -> completed UPDATE.
    case when new.league_start_date is distinct from old.league_start_date
          and not (old.league_start_date is null
                   and old.draft_status = 'in_progress' and new.draft_status = 'completed') then 'league_start_date' end,
    case when new.league_end_date is distinct from old.league_end_date
          and not (old.league_end_date is null
                   and old.draft_status = 'in_progress' and new.draft_status = 'completed') then 'league_end_date' end
  ], null);

  if cardinality(v_changed) > 0 then
    raise exception 'league_rules_locked: league rules cannot change once the draft has started (%)',
      array_to_string(v_changed, ', ')
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_league_rules_frozen_after_draft_start() from public;
revoke all on function public.enforce_league_rules_frozen_after_draft_start() from anon, authenticated;

-- trg_leagues_freeze_rules (20261104000000) stays bound: CREATE OR REPLACE
-- swaps the body under the existing trigger, so it is not dropped/re-created.

-- ----------------------------------------------------------------------------
-- INSERT: a user session creates leagues in 'not_started' only.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_leagues_insert_not_started()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.draft_status is distinct from 'not_started' then
    raise exception 'draft_status_server_only: a new league starts before its draft (got %)',
      coalesce(new.draft_status, 'NULL')
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_leagues_insert_not_started() from public;
revoke all on function public.enforce_leagues_insert_not_started() from anon, authenticated, service_role;

drop trigger if exists trg_leagues_insert_not_started on public.leagues;
create trigger trg_leagues_insert_not_started
  before insert on public.leagues
  for each row execute function public.enforce_leagues_insert_not_started();

-- ----------------------------------------------------------------------------
-- DRAFT TIME guard (user sessions only; service role / cron / SQL editor exempt)
-- ----------------------------------------------------------------------------
-- Decisions 4 + 5 (Giorgio, 2026-10-06):
--   * a draft time is on a quarter hour (:00/:15/:30/:45, no seconds) and at
--     least 55 minutes ahead (an hour of notice, with the Design Lead's
--     invisible slack for a slow form). draft_start_policy() holds both numbers;
--   * once the room has opened (now >= OLD.draft_date - 1h) the time cannot be
--     changed or cleared, EXCEPT while the league is postponed (a new time is
--     exactly what it needs; a real postponement already cleared draft_date).
-- Only a CHANGED value is judged (IS DISTINCT FROM), so league-settings'
-- always-sent same-value draft_date passes, legacy off-grid values included.
-- Only while not_started: after the draft starts draft_date is inert history
-- (20261104000000's ruling keeps it editable). TBD (NULL) stays allowed before
-- the room opens. The quarter hour is judged in UTC, which is the same grid in
-- America/New_York (whole-hour offsets, DST included).
-- SECURITY DEFINER: it reads draft_postponements, which no client role may
-- read (service-role table). It writes nothing; auth.uid() still reads the
-- caller's JWT claim, so the user-session test is unaffected.
create or replace function public.enforce_leagues_draft_time()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pol jsonb := public.draft_start_policy();
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.draft_date is not distinct from old.draft_date or old.draft_status <> 'not_started' then
      return new;
    end if;
    if old.draft_date is not null
       and now() >= old.draft_date - make_interval(secs => (v_pol->>'room_lead_s')::int)
       and not exists (select 1 from public.draft_postponements p where p.league_id = old.id) then
      raise exception 'draft_time_locked: the draft room is open, so the draft time can''t change'
        using errcode = '22023';
    end if;
  end if;
  if new.draft_date is not null then
    if date_trunc('minute', new.draft_date) <> new.draft_date
       or extract(minute from new.draft_date)::int % (v_pol->>'step_minutes')::int <> 0 then
      raise exception 'draft_time_invalid: pick a time on the quarter hour'
        using errcode = '22023';
    end if;
    if new.draft_date < now() + make_interval(secs => (v_pol->>'min_lead_s')::int) then
      raise exception 'draft_time_too_soon: pick a time at least an hour from now'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_leagues_draft_time() from public;
revoke all on function public.enforce_leagues_draft_time() from anon, authenticated, service_role;

drop trigger if exists trg_leagues_draft_time on public.leagues;
create trigger trg_leagues_draft_time
  before insert or update of draft_date on public.leagues
  for each row execute function public.enforce_leagues_draft_time();

-- A NEW draft time (every role: the commissioner's edit, #94's renewal RPC, or
-- an operator's from the SQL editor), while the draft is ahead:
--   * ends a postponement, and drops the stale watch row for the old time;
--   * tells EVERY human member, the person who made the change included
--     (Giorgio, 2026-10-06: "Anytime a draft time is changed, everyone receives
--     a notification to know exactly when it's happening"; "Everyone in the
--     league gets the notifications when draft times are changed").
--     DEBOUNCED: one pending row per member, re-stamped on
--     every change (league_notifications_draft_time_set_pending_uidx), sent
--     after 2 quiet minutes with the then-current time (draft-order-notify).
-- Clearing the time (TBD, or a postponement clearing it) notifies nobody here:
-- a postponement has its own push. AFTER, so a refused edit never gets here.
create or replace function public.after_leagues_draft_date_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.draft_status = 'not_started' and new.draft_date is not null
     and new.draft_date is distinct from old.draft_date then
    delete from public.draft_postponements where league_id = new.id;
    delete from public.draft_start_watch where league_id = new.id and draft_date <> new.draft_date;

    insert into public.league_notifications (league_id, user_id, kind)
    select new.id, m.user_id, 'draft_time_set'
      from public.league_members m
     where m.league_id = new.id
       and m.user_id not like 'bot-%'
    on conflict (league_id, user_id) where kind = 'draft_time_set' and push_status = 'pending'
    do update set created_at = now();
  elsif new.draft_status = 'not_started' and new.draft_date is null and old.draft_date is not null then
    -- Back to TBD: the old time's verdict and milestones must not be reused if
    -- the same time is picked again later.
    delete from public.draft_start_watch where league_id = new.id;
  end if;
  return null;
end;
$$;

revoke all on function public.after_leagues_draft_date_change() from public;
revoke all on function public.after_leagues_draft_date_change() from anon, authenticated, service_role;

drop trigger if exists trg_leagues_draft_rescheduled on public.leagues;
create trigger trg_leagues_draft_rescheduled
  after update of draft_date on public.leagues
  for each row execute function public.after_leagues_draft_date_change();

-- POST-PUSH CHECKS (HUMAN ACTION; the effect block is
-- docs/security/draft-auto-start-effect-test.sql):
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgname IN ('trg_leagues_freeze_rules','trg_leagues_insert_not_started',
--                     'trg_leagues_draft_time','trg_leagues_draft_rescheduled');
--   SELECT position('draft_status_server_only' in prosrc) > 0 FROM pg_proc
--    WHERE proname = 'enforce_league_rules_frozen_after_draft_start';   -- true
