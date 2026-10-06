-- ============================================================================
-- Freeze a league's rules once its draft has started
--   league_draft_slots (every row) + the leagues rule / season-shape columns
--   + no backward draft_status move, for user sessions (commissioner included)
-- ============================================================================
-- PROBLEM
--   Roster slots are the boundary for what a manager may buy: a draft pick
--   fills a slot, and since "tier trade slots" (Giorgio's ruling A) a trade buy
--   must fill a FREE slot and takes it (trades.slot_id). record_trade_atomic
--   (20261102000000) also re-checks the leagues rule columns stake_mode,
--   budget_amount, notional_per_slot, num_rounds and allow_undraftable. All of
--   them stayed writable by the commissioner after the draft:
--     * league_draft_slots_{insert,update,delete}_commissioner (20260810000004,
--       INTERIM) gate on is_commissioner(league_id) only, with no draft term;
--     * leagues_update_commissioner [I2a] (20260712000001, INTERIM) is a
--       full-row UPDATE for the commissioner.
--   So a commissioner could retune price brackets, delete slots or change the
--   stake rules mid-season and change every manager's legal buys. The
--   season-shape columns (num_weeks, duration_days, league_type,
--   num_participants) drive the schedule finalize_league_draft builds at draft
--   end, so changing them afterwards desyncs the league from its schedule.
--
--   WHAT EXISTING GUARDS ALREADY COVER (and why they are not enough):
--     * trg_leagues_member_update_columns (F1, 20260925000000) refuses a
--       NON-commissioner member any column but draft_status + a first-time
--       league_start/end_date stamp. It is a deliberate no-op for the
--       commissioner and the service role. It never looks at slots.
--     * trg_leagues_freeze_playoff_teams (20261012000002) freezes playoff_teams
--       for user sessions once old.draft_status is in_progress/completed.
--   THE REWIND HOLE, which defeats both of those and any freeze keyed on
--   draft_status: [I2a] lets the commissioner PATCH draft_status from
--   'completed' back to 'not_started', edit, then PATCH it to 'completed'
--   again. trg_leagues_order_start only fires on exits FROM not_started, and a
--   re-start passes while the locked order still matches the members. No
--   product flow writes a backward status from a user session (grep
--   2026-11-04: web DraftPage -> in_progress, draft-control -> in_progress
--   (service role), web completeDraft / finalize_league_draft -> completed).
--
-- RULES (user sessions only: auth.uid() IS NOT NULL)
--   1. draft_status may move only along this explicit table:
--          not_started -> in_progress
--          not_started -> completed     (the [I2a] direct jump; it also locks
--                                        the draft order, 20261013000000)
--          in_progress -> completed
--      An unchanged value is not a move. Any other pair -- including a value
--      outside the CHECK set ('not_started','in_progress','completed',
--      20251205000000) or NULL -- is refused. Fail closed, not "numerically
--      forward".
--   2. Once OLD.draft_status is anything but exactly 'not_started' (so an
--      unknown value is frozen too), these columns may not change VALUE:
--          stake_mode, budget_amount, notional_per_slot, num_rounds,
--          allow_undraftable                              (record-trade's rules)
--          num_weeks, duration_days, league_type, num_participants
--                                                        (season shape)
--      VALUE comparison, not SET-list membership: apps/mobile league-settings
--      and web Leagues.jsx handleUpdate always send these columns, so a
--      same-value patch (a rename after the draft from a stale screen) must
--      pass. Judged on OLD, like the playoff_teams freeze: one UPDATE that
--      changes a rule AND starts the draft is allowed (the league was still
--      not_started).
--      NOT frozen: name, draft_date (editable by ruling), playoff_teams
--      (already frozen by 20261012000002), everything else.
--   3. league_draft_slots: no INSERT, UPDATE or DELETE once the parent
--      league's draft_status is anything but exactly 'not_started'. For an
--      UPDATE both the OLD and the NEW league are checked (re-parenting a slot
--      into a started league is refused, and so is moving one out of it).
--
-- WHO IS EXEMPT: auth.uid() IS NULL -- service_role, cron, migrations, the
--   dashboard SQL editor. Same test as F1 and the playoff_teams freeze, so a
--   deliberate server-side repair still works. finalize_league_draft (service
--   role only, admin client with no forwarded JWT) stamps num_weeks while the
--   league is in_progress; it is on this exempt path.
--   NOTE: a SECURITY DEFINER RPC invoked with a user JWT is NOT exempt
--   (auth.uid() is the caller). PR #94 "Run it back" (origin/feat/run-it-back,
--   not on main at authoring time) has two such RPCs; both are compatible as
--   written: renew_league INSERTs a NEW league with draft_status
--   'not_started' and copies slots into it, and start_renewed_season rewrites
--   rules + slots only while draft_status = 'not_started'. If either ever
--   writes a started league, it must do so on a service-role path.
--
-- WHY TRIGGERS, NOT NARROWED POLICIES
--   * leagues: RLS has no per-column WITH CHECK (the reason F1 is a trigger).
--   * league_draft_slots: a narrowed USING on UPDATE/DELETE fails SILENTLY --
--     the statement matches 0 rows and PostgREST returns 200. saveLeagueSlots
--     is delete-then-insert, so a stale client would see a quiet no-op delete
--     and then a confusing insert error. A trigger raises one named 42501 for
--     every operation. The interim policies stay as they are.
--   Error prefixes (clients may map them; PostgREST returns HTTP 403):
--     league_slots_locked, league_rules_locked, league_draft_status_locked.
--
-- THE RACE, AND WHY FOR SHARE CANNOT DEADLOCK WITH A DRAFT START
--   Without a lock, a slot write under READ COMMITTED could read
--   'not_started' while a draft start is in flight, and land after the start
--   commits. The slot trigger therefore reads the parent league FOR SHARE.
--   FOR SHARE conflicts with the start's row lock (FOR NO KEY UPDATE), so:
--     * start first: the slot write waits, then re-reads the committed row,
--       sees in_progress, and raises;
--     * slot write first: the start waits until the slot write commits, so the
--       slots the draft runs on are the committed ones.
--   A deadlock needs a cycle. The slot write holds slot-row locks and the
--   league SHARE lock; the only thing it waits for is the league row. A draft
--   start (draft-control's UPDATE, web's [I2a] flip, and their BEFORE/AFTER
--   triggers, which touch only leagues and the draft-order tables) never
--   locks a league_draft_slots row, so it never waits for the slot write's
--   other locks: no cycle. Two slot writers both take SHARE, which is
--   compatible. INVARIANT for future writers: a transaction that writes slots
--   AND updates their league must UPDATE the league FIRST (start_renewed_season
--   does), because SHARE-then-upgrade in two concurrent transactions is the
--   classic upgrade deadlock. When OLD and NEW leagues differ, both are locked
--   in id order.
--   CASCADE: a commissioner's DELETE of a league cascades to its slots with
--   the commissioner's auth.uid(). By the time the cascade's DELETE runs, the
--   parent row is already gone in this transaction, so the lookup finds
--   nothing and the trigger allows it. "League not found" is safe to allow on
--   every op: an INSERT/UPDATE into a missing league still fails the FK.
--   TRUNCATE: row triggers do not fire on it, but PostgREST exposes no
--   TRUNCATE, so no user session can issue one.
--
-- SECURITY
--   enforce_league_draft_slots_frozen is SECURITY DEFINER so the league read
--   cannot be hidden by RLS (a hidden row would read as "not found" -> allow,
--   which would fail open). The rules trigger reads only OLD/NEW and
--   auth.uid(), so it is SECURITY INVOKER. Both pin search_path. Neither can
--   be called directly (returns trigger), and firing a trigger does not check
--   EXECUTE, but the PUBLIC grant AND Supabase's explicit anon/authenticated
--   default grants are revoked so proacl reads as the lockdown it is
--   (CLAUDE.md: REVOKE FROM PUBLIC does not clear them).
--
-- POST-PUSH CHECKS (read-only):
--   SELECT tgname, tgrelid::regclass, tgenabled FROM pg_trigger
--    WHERE tgname IN ('trg_league_draft_slots_freeze', 'trg_leagues_freeze_rules');
--   SELECT proname, prosecdef, proconfig, proacl FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND proname IN ('enforce_league_draft_slots_frozen',
--                      'enforce_league_rules_frozen_after_draft_start');
--   -- expect no anon= / authenticated= / =X/ (PUBLIC) entries
--
-- HUMAN ACTION: `supabase db push` is Giorgio's.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. leagues: rule + season-shape columns, and the draft_status transition table
-- ----------------------------------------------------------------------------
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

  -- (1) draft_status moves only along the allowed table; anything else,
  -- unknown values and NULL included, is refused (CASE falls to false).
  if new.draft_status is distinct from old.draft_status
     and not (case
                when old.draft_status = 'not_started'
                     and new.draft_status in ('in_progress', 'completed') then true
                when old.draft_status = 'in_progress'
                     and new.draft_status = 'completed' then true
                else false
              end) then
    raise exception 'league_draft_status_locked: the draft status cannot move from % to %',
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
    case when new.num_participants  is distinct from old.num_participants  then 'num_participants' end
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

drop trigger if exists trg_leagues_freeze_rules on public.leagues;
create trigger trg_leagues_freeze_rules
  before update on public.leagues
  for each row execute function public.enforce_league_rules_frozen_after_draft_start();

-- ----------------------------------------------------------------------------
-- 2. league_draft_slots: no write once the parent league's draft has started
-- ----------------------------------------------------------------------------
create or replace function public.enforce_league_draft_slots_frozen()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_l   record;
begin
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_ids := case tg_op
             when 'INSERT' then array[new.league_id]
             when 'DELETE' then array[old.league_id]
             else array[old.league_id, new.league_id]
           end;

  -- FOR SHARE, in id order: waits out an in-flight draft start (see header).
  -- A league that is not found is the ON DELETE CASCADE from deleting it, or
  -- an FK violation still to come: allow either.
  for v_l in
    select l.id, l.draft_status
      from public.leagues l
     where l.id = any (v_ids)
     order by l.id
       for share
  loop
    if v_l.draft_status is distinct from 'not_started' then
      raise exception 'league_slots_locked: roster slots cannot change once the draft has started'
        using errcode = '42501';
    end if;
  end loop;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.enforce_league_draft_slots_frozen() from public;
revoke all on function public.enforce_league_draft_slots_frozen() from anon, authenticated;

drop trigger if exists trg_league_draft_slots_freeze on public.league_draft_slots;
create trigger trg_league_draft_slots_freeze
  before insert or update or delete on public.league_draft_slots
  for each row execute function public.enforce_league_draft_slots_frozen();
