-- ============================================================================
-- Freeze a league's rules once its draft has started
--   league_draft_slots (every row) + the leagues rule / season-shape / season-
--   state columns + no backward draft_status move + no leaving the league,
--   for user sessions (commissioner included)
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
--   The season-state columns (season_status, current_week, current_season_id,
--   league_start_date / league_end_date = the scoring window, commissioner_id)
--   are the same boundary: rewriting them on a live season reshapes scoring.
--   So is the membership: [I5] league_members_delete_self (20260712000002,
--   INTERIM) lets ANY member, the commissioner included, DELETE their own
--   league_members row at any time. A post-draft departure leaves a zombie
--   team: start_league_playoffs refuses its bracket forever
--   (bracket_non_member), checkStoredOrder 500s (draft_order_invalid), and
--   the departed manager's drafts/trades still score. No live client leaves
--   (mobile 1.1.0 has no leave; the paused web app does, useLeagues.js:244).
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
--          season_status, current_week, current_season_id, commissioner_id
--                                                        (season state)
--          budget_mode            (retired; frozen so it is not a
--                                  writable-but-meaningless column)
--      and league_start_date / league_end_date may change only by F1's
--      completion stamp: NULL -> value, and ONLY in the completing UPDATE
--      (OLD in_progress -> NEW completed). That is the exact shape F1 admits
--      for a member ([I2b] admits a member only on that transition), now for
--      the commissioner too. Changing a non-NULL value, clearing it, or
--      stamping a NULL date at any other time (e.g. on a league that jumped
--      straight to completed, with hindsight) is refused. Today no
--      user-session writer stamps them at all (grep 2026-11-04: the web
--      completeDraft write moved into finalize_league_draft, service role).
--      VALUE comparison, not SET-list membership: apps/mobile league-settings
--      and web Leagues.jsx handleUpdate always send these columns, so a
--      same-value patch (a rename after the draft from a stale screen) must
--      pass. Judged on OLD, like the playoff_teams freeze: one UPDATE that
--      changes a rule AND starts the draft is allowed (the league was still
--      not_started).
--      EVERY leagues column is classified in
--      supabase/tests/freeze_league_rules.pglite.test.ts (frozen here,
--      stamp-once here, guarded by another named trigger, or deliberately
--      editable: name, draft_date, invite_code, created_at). The
--      test replays every CREATE/ALTER TABLE leagues in the migrations, so a
--      NEW column fails it until someone classifies it. This list is
--      enumerated (unlike F1's whole-row compare); the test is what stops a
--      future rule column from silently staying commissioner-writable.
--      COMMISSIONER TRANSFER is therefore closed for user sessions once the
--      draft starts. The planned leave-league RPC must run on a service-role
--      path: a SECURITY DEFINER function called with a user JWT still has
--      auth.uid() set and is NOT exempt.
--   3. league_draft_slots: no INSERT, UPDATE or DELETE once the parent
--      league's draft_status is anything but exactly 'not_started'. For an
--      UPDATE both the OLD and the NEW league are checked (re-parenting a slot
--      into a started league is refused, and so is moving one out of it).
--   4. league_members: no DELETE once the league's draft_status is anything
--      but exactly 'not_started' (league_membership_locked). INTERIM, until
--      the leave-league flow ships: that worker decides whether [I5] is
--      dropped and whether a left_at column replaces the DELETE; this
--      migration deliberately does neither. Pre-draft leave is unchanged.
--      LAYERING with trg_league_members_draft_order (20261013000000, AFTER
--      DELETE, every role): that trigger refuses a leave from a league whose
--      order is LOCKED and draft in_progress ('draft_in_progress', 22023),
--      for the service role too. For a USER session this BEFORE trigger
--      fires first, so a user always sees league_membership_locked, mid-draft
--      and after. The older refusal stays as the service-role mid-draft rule.
--      This guard keys on draft_status alone, so it also covers a started
--      league whose draft order is not 'locked' (the older trigger lets that
--      leave through).
--      LOCK: FOR NO KEY UPDATE on the league, NOT FOR SHARE. The AFTER
--      trigger above takes FOR NO KEY UPDATE on the same row in the same
--      transaction; a SHARE here would make two concurrent leavers each hold
--      SHARE and then both wait to upgrade = deadlock. Taking the stronger
--      lock first serializes leavers (and leaves vs. a draft start) instead.
--      CASCADE: the only FK into league_members is league_members.league_id
--      -> leagues ON DELETE CASCADE (user_id has no FK). A league delete
--      cascades with the deleter's auth.uid(); the league row is gone by
--      then, so "league not found => allow" lets it through, same as slots.
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
--   rules + slots only while draft_status = 'not_started' (league UPDATE
--   first, matching the lock invariant below). #94's trg_leagues_renewal_gate
--   sets NEW.num_participants on the start UPDATE; that UPDATE's OLD is
--   'not_started', so this freeze allows it (and it sorts after
--   trg_leagues_freeze_rules anyway). Checked against #94 @ f450e78
--   (migrations 20261105000000-09, after this one): respond_to_renewal's
--   self-leave DELETE and cancel_league_renewal's league DELETE act only on
--   'not_started' leagues (allowed; the cascade is allowed regardless);
--   trg_league_members_renewal_sync_delete is AFTER DELETE and returns early
--   when the league is gone; trg_league_members_renewal_guard is INSERT-only;
--   trg_leagues_lineage_columns guards #94's three new leagues columns, which
--   #94 must add to the classification (test + effect block) when it rebases.
--   If any of them ever writes a started league, it must do so on a
--   service-role path.
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
--   A deadlock needs a cycle. For an UPDATE/DELETE the slot tuple is locked
--   FIRST (before a BEFORE ROW trigger runs) and the league SHARE second; an
--   INSERT holds no slot lock yet. No league WRITER in a normal flow waits on
--   a slot row while holding a lock that conflicts with SHARE: a draft start
--   (draft-control's UPDATE, web's [I2a] flip, and their BEFORE/AFTER
--   triggers, which touch only leagues and the draft-order tables) and
--   finalize_league_draft (FOR UPDATE on the league) never touch slots. Pick
--   and trade inserts do take FOR KEY SHARE on slot rows (drafts.slot_id /
--   trades.slot_id FKs), but they hold only KEY SHARE on the league, which is
--   compatible with SHARE, and record_trade_atomic serializes on an advisory
--   lock. So no cycle. Two slot writers both take SHARE, which is compatible.
--   THE ONE EXCEPTION is a league DELETE: it holds FOR UPDATE on the league,
--   then its cascade locks the slot rows (and member rows). Racing it with a
--   slot UPDATE/DELETE (or a leave) on the same league is a real cycle;
--   Postgres detects it and aborts one side with 40P01 (no hang, nothing
--   half-written). It needs the commissioner racing their own league delete,
--   or a member leaving during it. The member trigger has the same shape, as
--   did the pre-existing AFTER trigger in 20261013000000.
--   INVARIANT for future writers: a transaction that writes slots
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
--    WHERE tgname IN ('trg_league_draft_slots_freeze', 'trg_leagues_freeze_rules',
--                     'trg_league_members_freeze_leave');
--   SELECT proname, prosecdef, proconfig, proacl FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND proname IN ('enforce_league_draft_slots_frozen',
--                      'enforce_league_rules_frozen_after_draft_start',
--                      'enforce_league_members_frozen_after_draft_start');
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
  -- Only the CALLER'S OWN leagues are read and locked. This DEFINER trigger
  -- fires BEFORE the INSERT/UPDATE WITH CHECK, so reading any league_id
  -- would let any user probe another league's draft state (league_slots_locked
  -- vs the RLS error) and take a SHARE lock on its row. Every slot write
  -- policy requires is_commissioner(league_id) (20260810000004), so skipping a
  -- league the caller does not commission defers to RLS, which refuses it.
  -- (With auth.uid() NULL this scope matches nothing, so the explicit
  -- exemption above is belt-and-braces: the two agree by construction.)
  for v_l in
    select l.id, l.draft_status
      from public.leagues l
     where l.id = any (v_ids)
       and l.commissioner_id = auth.uid()::text
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

-- ----------------------------------------------------------------------------
-- 3. league_members: no leaving once the draft has started (INTERIM, see 4.)
-- ----------------------------------------------------------------------------
create or replace function public.enforce_league_members_frozen_after_draft_start()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if auth.uid() is null then
    return old;
  end if;

  -- FOR NO KEY UPDATE (not SHARE): trg_league_members_draft_order takes this
  -- lock on the same row after the DELETE; see the header on the deadlock.
  select l.draft_status into v_status
    from public.leagues l
   where l.id = old.league_id
     for no key update;
  if not found then
    return old;   -- the league itself is being deleted (ON DELETE CASCADE)
  end if;

  if v_status is distinct from 'not_started' then
    raise exception 'league_membership_locked: members cannot leave a league once its draft has started'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

revoke all on function public.enforce_league_members_frozen_after_draft_start() from public;
revoke all on function public.enforce_league_members_frozen_after_draft_start() from anon, authenticated;

drop trigger if exists trg_league_members_freeze_leave on public.league_members;
create trigger trg_league_members_freeze_leave
  before delete on public.league_members
  for each row execute function public.enforce_league_members_frozen_after_draft_start();
