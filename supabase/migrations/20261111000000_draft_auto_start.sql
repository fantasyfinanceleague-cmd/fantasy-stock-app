-- ============================================================================
-- Draft auto-start (Giorgio, 2026-10-06). Plan + decisions:
-- docs/migrations/DRAFT_AUTO_START_PLAN.md.
--
--   "the draft is not something that is started manually. It should be
--    something that starts at the minute that is selected by the commissioner."
--   Decisions (2026-10-06, via the Orchestrator): "people still need an hour
--   heads up and notice". The REAL GATE is room-open time (T-1h): blocked
--   then -> the room does not open, the draft does not start, the league is
--   POSTPONED, everyone is told, and the commissioner picks a NEW time (which
--   again gives >= 1 h notice). No late start. The commissioner is warned
--   BEFORE the room opens: the moment the league becomes blocked, and again at
--   T-2h if still blocked.
--
-- PROVISIONAL TIMESTAMP (20261111000000-09). Requires 20261106000000 (the
-- auto-pick cron) and 20261107000000-06 (#126) applied first.
--
-- THE LIFECYCLE (T = draft_date), all on the service role:
--   before T-1h   draft-autopick-sweep's WATCH pass evaluates every scheduled
--                 league whose inputs changed (or every 5 min inside 24 h, for
--                 price drift) and records the verdict here
--                 (record_draft_watch). Becoming blocked writes a
--                 'draft_at_risk' notice to the commissioner; still blocked at
--                 T-2h writes a reminder.
--   T-1h-30s..T   the GATE: blocked -> postpone_league_draft (stage
--                 'room_open'); clear -> gate_cleared_at. The 30 s lead lets the
--                 sweep (10 s) decide before #67 finalizes the order at T-1h.
--   >= T-1h       open_due_draft_rooms (draft-order-notify, every minute):
--                 finalizes the order and writes 'draft_room_open' (with the
--                 position) to every human; late joiners get theirs too.
--   >= T          the sweep's START pass: start_league_draft (row lock, room
--                 must have opened, floor, CAS) -> 'draft_started' to everyone.
--                 Blocked at T (rare: leaving is locked after T-1h) -> postpone
--                 (stage 'start').
-- Pushes are delivered by draft-order-notify from league_notifications.
--
-- WHY A NEW 'draft_room_open' KIND instead of #67's 'draft_order_set': that
-- notice is written by every finalize and has a partial UNIQUE index (one per
-- member per league, EVER), so a league postponed after its order was set
-- could never announce its new time. 'draft_room_open' is written only by the
-- gate, deduped per draft time (draft_start_watch.room_opened_at). #67's rows
-- stay as in-app records; trg_league_notifications_order_set_in_app marks
-- their push 'skipped' at insert so nobody gets both, and no #67 function is
-- re-created. Pending legacy rows are settled the same way below.
--
-- POSTPONED is an explicit row (draft_postponements), never derived from a
-- past draft_date (CLAUDE.md: overloaded NULLs / time are not type tags).
-- A postponement (real or legacy) also clears leagues.draft_date, so (a)
-- nothing is "due" for #67 any more, (b) leaving re-opens (#126 locks on
-- _draft_order_is_due(draft_date)), (c) every client shows "no time set"; and
-- _draft_order_sync (re-created below) never finalizes a postponed league.
-- postponed_from keeps the old time. A new draft_date clears the row
-- (trg_leagues_draft_rescheduled, 20261111000001).
--
-- CONCURRENCY: postpone and start take the league row FOR UPDATE; the watch
-- recorder takes FOR SHARE; joins/leaves (#67/#123/#126 triggers) take FOR NO
-- KEY UPDATE. All serialize on the same row; every writer re-reads after the
-- lock (READ COMMITTED) and re-checks draft_status / draft_date / postponement.
-- PGlite has one connection, so this is argued here and pinned structurally.
--
-- Game-flow outcomes are jsonb values, never raises, so .rpc()'s { error }
-- stays reserved for real failures (CLAUDE.md success signals #5).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The policy's numbers (SQL side). Mirrored by
--    supabase/functions/_shared/draft-start-policy.ts; a test pins them equal.
-- ---------------------------------------------------------------------------
create or replace function public.draft_start_policy()
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'room_lead_s',     3600,    -- the room opens (order set, #67) at T-1h
    'gate_lead_s',     30,      -- the gate decides this long before the room opens
    'reminder_lead_s', 7200,    -- the commissioner's reminder at T-2h
    'refresh_s',       300,     -- re-evaluate an unchanged league this often...
    'horizon_s',       86400,   -- ...once its draft is within 24 h (price drift)
    'min_lead_s',      3300,    -- a user-set draft time is >= now + 55 min
    'step_minutes',    15)      -- ...on a quarter hour
$$;

comment on function public.draft_start_policy() is
  'Draft auto-start policy numbers (20261111000000). Mirrored by supabase/functions/_shared/draft-start-policy.ts; supabase/tests/draft_auto_start.pglite.test.ts pins them equal.';

revoke all on function public.draft_start_policy() from public;
revoke all on function public.draft_start_policy() from anon, authenticated;
grant execute on function public.draft_start_policy() to service_role;

-- ---------------------------------------------------------------------------
-- 2. State tables (service role only; no client grant)
-- ---------------------------------------------------------------------------
create table if not exists public.draft_start_watch (
  league_id        uuid primary key references public.leagues(id) on delete cascade,
  -- The draft time this row describes. A row for a different draft_date is a
  -- previous episode: every reader compares it with leagues.draft_date.
  draft_date       timestamptz not null,
  inputs_sig       text not null,          -- md5 of _draft_start_inputs at evaluation
  evaluated_at     timestamptz not null default now(),
  blocked          boolean not null,       -- the discriminator; blocked_since is detail
  blockers         jsonb not null default '[]'::jsonb,
  blocked_since    timestamptz,
  reminded_at      timestamptz,            -- the T-2h reminder went out (this episode)
  gate_cleared_at  timestamptz,            -- the gate found it clear (this episode)
  room_opened_at   timestamptz             -- the 'draft_room_open' notices went out
);

comment on table public.draft_start_watch is
  'Draft auto-start: the latest blocker verdict per league for its CURRENT draft_date (record_draft_watch), plus the episode''s milestones (reminder, gate, room open). Service role only. Deleted on start and on postponement.';

create table if not exists public.draft_postponements (
  league_id      uuid primary key references public.leagues(id) on delete cascade,
  postponed_from timestamptz not null,     -- the draft time that could not happen
  postponed_at   timestamptz not null default now(),
  stage          text not null,
  reason         text not null,            -- the first blocker's code
  blockers       jsonb not null default '[]'::jsonb,
  constraint draft_postponements_stage_check check (stage in ('room_open', 'start', 'legacy'))
);

comment on table public.draft_postponements is
  'Draft auto-start: the explicit POSTPONED state. One row per league whose draft could not happen at postponed_from; the commissioner must set a new draft_date (which deletes the row, trg_leagues_draft_rescheduled). stage: room_open (blocked at the T-1h gate), start (blocked at T), legacy (a not_started league whose time had already passed when 20261111000000 was pushed; nobody was notified).';

alter table public.draft_start_watch   enable row level security;
alter table public.draft_postponements enable row level security;
-- No policies: clients read the state through draft-control status. Writes go
-- through the SECURITY DEFINER functions below (they run as the owner), so the
-- service role reads only.
revoke all on table public.draft_start_watch   from anon, authenticated;
revoke all on table public.draft_postponements from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.draft_start_watch   from service_role;
revoke insert, update, delete, truncate, references, trigger on table public.draft_postponements from service_role;
grant select on table public.draft_start_watch   to service_role;
grant select on table public.draft_postponements to service_role;

-- ---------------------------------------------------------------------------
-- 3. Notification kinds: the union of #67, #94, #126, #132 and these six.
-- ---------------------------------------------------------------------------
alter table public.league_notifications
  drop constraint if exists league_notifications_kind_check;
alter table public.league_notifications
  add constraint league_notifications_kind_check check (kind in (
    'draft_order_set',
    -- PR #94 (Run it back), kept so this CHECK stays a superset of its own:
    'renewal_invite', 'renewal_reply', 'renewal_nudge', 'renewal_removed', 'season_set',
    'member_left',      -- #126
    'commissioner_transferred', -- #132 (20261110000000): to the new commissioner
    -- draft auto-start (this file); delivered by draft-order-notify:
    'draft_room_open',  -- everyone: the room is open, with your position
    'draft_started',    -- everyone: the draft has started
    'draft_at_risk',    -- the commissioner: the room can't open as things stand
    'draft_at_risk_reminder', -- the commissioner, T-2h, still blocked: one hour left
    'draft_postponed',  -- everyone: it can't happen; a new time is needed
    'draft_time_set'    -- everyone: the draft time was set or changed (debounced, below)
  ));

-- Giorgio (2026-10-06): "Anytime a draft time is changed, everyone receives a
-- notification to know exactly when it's happening." DEBOUNCE: at most ONE
-- pending 'draft_time_set' row per member per league. A change while one is
-- pending re-stamps its created_at instead of adding a row
-- (trg_leagues_draft_rescheduled, 20261111000001, ON CONFLICT on this index),
-- and draft-order-notify sends it only once the time has been quiet for 2
-- minutes, worded from the CURRENT draft_date. So a commissioner fiddling with
-- the picker produces one push, with the final time. A row being sent
-- ('sending') leaves the index, so a change during a send is its own notice.
create unique index if not exists league_notifications_draft_time_set_pending_uidx
  on public.league_notifications (league_id, user_id)
  where kind = 'draft_time_set' and push_status = 'pending';

-- #67's 'draft_order_set' rows stay as in-app records, but their PUSH is
-- superseded by 'draft_room_open' (see the header). Settled at insert, so no
-- row is ever left pending for draft_order_notify_due() to post about.
create or replace function public.league_notifications_order_set_in_app()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.kind = 'draft_order_set' and new.push_status = 'pending' then
    new.push_status := 'skipped';
    new.push_error  := 'superseded_by_draft_room_open';
  end if;
  return new;
end;
$$;

revoke all on function public.league_notifications_order_set_in_app() from public;
revoke all on function public.league_notifications_order_set_in_app() from anon, authenticated, service_role;

drop trigger if exists trg_league_notifications_order_set_in_app on public.league_notifications;
create trigger trg_league_notifications_order_set_in_app
  before insert on public.league_notifications
  for each row execute function public.league_notifications_order_set_in_app();

-- One-off: rows #67 created while its cron was deferred (never delivered).
update public.league_notifications
   set push_status = 'skipped', push_error = 'superseded_by_draft_room_open'
 where kind = 'draft_order_set' and push_status in ('pending', 'sending');

-- ---------------------------------------------------------------------------
-- A postponed league's order is never finalized (security review, M3)
-- ---------------------------------------------------------------------------
-- _draft_order_sync re-created from 20261107000006 VERBATIM plus TWO clauses in
-- the finalize branch (diff it): not while a draft_postponements row exists,
-- and only once the auto-start gate has cleared this draft time (supabase
-- review #3: otherwise a lazy read could set the order of a league the gate
-- then postpones, locking its members in, #126). The start backstop
-- (lock_draft_order_on_start) finalizes directly and is unaffected.
-- Every #67/#126 finalize path goes through it (the lazy reads, joins,
-- trg_leagues_order_mode's finalize-at-the-OLD-date on any leagues UPDATE,
-- finalize_due_draft_orders, confirm_league_roster, join_league_by_code), so a
-- postponement inserted BEFORE its date is cleared can never finalize an order
-- on the way out — including the legacy backfill below, where the old dates
-- are long past and would otherwise be "due".
create or replace function public._draft_order_sync(p_league_id uuid, p_lock boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_l public.leagues%rowtype;
begin
  if p_lock then
    select * into v_l from public.leagues where id = p_league_id for no key update;
  else
    select * into v_l from public.leagues where id = p_league_id;
  end if;
  if not found or coalesce(v_l.draft_status, 'not_started') <> 'not_started' then
    return;
  end if;

  if public._draft_order_is_due(v_l.draft_date)
     and (select count(*) from public.league_members m where m.league_id = p_league_id) >= 4
     -- 20261107000006: and the commissioner has confirmed the teams after a leave
     and not exists (select 1 from public.league_roster_reconfirm rc where rc.league_id = p_league_id)
     -- 20261111000000: and the draft is not postponed (draft auto-start)
     and not exists (select 1 from public.draft_postponements pp where pp.league_id = p_league_id)
     -- 20261111000000: and the auto-start gate cleared THIS draft time: the order
     -- is set when the room opens, never before the gate has judged the league
     -- (a time set 55-60 min out is already past T-1h when it is saved)
     and exists (select 1 from public.draft_start_watch gw
                  where gw.league_id = p_league_id and gw.draft_date = v_l.draft_date
                    and gw.gate_cleared_at is not null) then
    perform public._draft_order_finalize(p_league_id);
  elsif v_l.draft_order_mode = 'manual' then
    perform public._draft_order_materialize(p_league_id, 'manual_seed');
  end if;
end;
$$;

revoke all on function public._draft_order_sync(uuid, boolean) from public, anon, authenticated, service_role;

-- One-off LEGACY backfill: every not_started league whose draft time has
-- already passed is postponed silently (stage 'legacy', NO notices), so the
-- first sweep tick starts nothing and pushes nothing about abandoned leagues.
-- Like a real postponement, the row goes in FIRST and then draft_date is
-- cleared (the old time is kept in postponed_from): nothing is "due" for #67
-- any more (so the promoted notify cron's guard stays quiet about them),
-- leaving re-opens per #126, and the gated _draft_order_sync above means the
-- UPDATE's own trg_leagues_order_mode cannot finalize at the old date. This
-- runs before 20261111000001's triggers exist (no time-set notices, no guard).
-- An order already finalized before this push (e.g. by #67's own one-off
-- sweep) stays as it is.
insert into public.draft_postponements (league_id, postponed_from, stage, reason)
select l.id, l.draft_date, 'legacy', 'legacy_past_date'
  from public.leagues l
 where l.draft_status = 'not_started'
   and l.draft_date is not null
   and l.draft_date <= now()
on conflict (league_id) do nothing;

update public.leagues l
   set draft_date = null
  from public.draft_postponements p
 where p.league_id = l.id and p.stage = 'legacy'
   and l.draft_status = 'not_started' and l.draft_date is not null;

-- ---------------------------------------------------------------------------
-- 4. _draft_start_inputs — every input the blocker evaluation judges
-- ---------------------------------------------------------------------------
-- The exact shape buildStartExpect (supabase/functions/_shared/draft-start.ts)
-- sends; compared with jsonb `=` (numerics by value, 250 = 250.00). Used as the
-- compare-and-swap in record_draft_watch / start_league_draft, and (md5) as the
-- watch's change signature.
create or replace function public._draft_start_inputs(p_league_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'members',           (select count(*)::int from public.league_members m where m.league_id = l.id),
    'stake_mode',        l.stake_mode,
    'budget_amount',     l.budget_amount,
    'num_rounds',        l.num_rounds,
    'allow_undraftable', l.allow_undraftable,
    'league_type',       l.league_type,
    'playoff_teams',     l.playoff_teams,
    'reconfirm_owed',    exists (select 1 from public.league_roster_reconfirm r where r.league_id = l.id),
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',          s.id::text,
               'slot_index',  s.slot_index,
               'slot_count',  s.slot_count,
               'price_min',   s.price_min,
               'price_max',   s.price_max,
               'category_id', s.category_id::text)
             order by s.slot_index, s.id)
        from public.league_draft_slots s
       where s.league_id = l.id), '[]'::jsonb))
    from public.leagues l
   where l.id = p_league_id
$$;

revoke all on function public._draft_start_inputs(uuid) from public;
revoke all on function public._draft_start_inputs(uuid) from anon, authenticated;
grant execute on function public._draft_start_inputs(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. draft_watch_due — leagues the sweep should evaluate this tick
-- ---------------------------------------------------------------------------
--   * before the room opens: no verdict for this draft time yet, the inputs
--     changed (a leave, a join, a settings edit), the verdict is older than
--     refresh_s and the draft is within horizon_s (price drift), or the T-2h
--     reminder is due;
--   * in the gate window [T-1h-30s, T): until the gate clears it (or it is
--     postponed), and again if its inputs change before its room opens (a
--     leave in the last 30 s before T-1h is still allowed by #126: it must be
--     judged, and postponed with its real reason, not left to fail at T). This
--     also covers a draft time set less than an hour out (the 55-minute floor):
--     it is gated on the first tick.
create or replace function public.draft_watch_due()
returns table (league_id uuid, draft_date timestamptz)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with p as (select public.draft_start_policy() j)
  select l.id, l.draft_date
    from public.leagues l
    cross join p
    left join public.draft_start_watch w on w.league_id = l.id and w.draft_date = l.draft_date
   where l.draft_status = 'not_started'
     and l.draft_date is not null
     and l.draft_date > now()
     and not exists (select 1 from public.draft_postponements x where x.league_id = l.id)
     and (
       (now() >= l.draft_date - make_interval(secs => (p.j->>'room_lead_s')::int + (p.j->>'gate_lead_s')::int)
        and (w.gate_cleared_at is null
             or (w.room_opened_at is null
                 and w.inputs_sig is distinct from md5(public._draft_start_inputs(l.id)::text))))
       or
       (now() < l.draft_date - make_interval(secs => (p.j->>'room_lead_s')::int)
        and (w.league_id is null
             or w.inputs_sig is distinct from md5(public._draft_start_inputs(l.id)::text)
             or (w.evaluated_at < now() - make_interval(secs => (p.j->>'refresh_s')::int)
                 and l.draft_date < now() + make_interval(secs => (p.j->>'horizon_s')::int))
             or (w.blocked and w.reminded_at is null
                 and now() >= l.draft_date - make_interval(secs => (p.j->>'reminder_lead_s')::int))))
     )
   -- Urgency first (security review M2): a league in its gate window must be
   -- judged before any number of quieter ones, or it misses its room.
   order by (now() >= l.draft_date - make_interval(secs => (p.j->>'room_lead_s')::int + (p.j->>'gate_lead_s')::int)) desc,
            l.draft_date, l.id;
$$;

revoke all on function public.draft_watch_due() from public;
revoke all on function public.draft_watch_due() from anon, authenticated;
grant execute on function public.draft_watch_due() to service_role;

-- The sweep cron's auto-start post guard (20261111000002), isolated: a runtime
-- error in either list returns false instead of failing the whole cron
-- statement, so it can never take down the auto-pick backstop for live drafts
-- (supabase review #6). The error is raised as a WARNING into the postgres log.
create or replace function public.draft_auto_start_work_due()
returns boolean
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  return exists (select 1 from public.due_draft_starts()) or exists (select 1 from public.draft_watch_due());
exception when others then
  raise warning 'draft_auto_start_work_due failed: % %', sqlstate, sqlerrm;
  return false;
end;
$$;

revoke all on function public.draft_auto_start_work_due() from public;
revoke all on function public.draft_auto_start_work_due() from anon, authenticated;
grant execute on function public.draft_auto_start_work_due() to service_role;

-- ---------------------------------------------------------------------------
-- 6. record_draft_watch — store a verdict; warn the commissioner on change
-- ---------------------------------------------------------------------------
-- p_blocked: true / false, or NULL = unknown (the feasibility pool could not be
-- read): the previous verdict is kept, nobody is notified. p_gate: the caller
-- is in the gate window; a clear verdict (or an unknown one once the room's
-- time has come — fail open for the NOTICE; the start re-checks and fails
-- closed) sets gate_cleared_at.
-- 'draft_at_risk' goes to the commissioner when the league BECOMES blocked
-- (no verdict, or clear, before); 'draft_at_risk_reminder' once at T-2h if it
-- is still blocked. A transition already inside T-2h counts as the reminder,
-- so nobody gets two.
create or replace function public.record_draft_watch(
  p_league_id  uuid,
  p_draft_date timestamptz,
  p_expect     jsonb,
  p_blocked    boolean,
  p_blockers   jsonb,
  p_gate       boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_l        public.leagues%rowtype;
  v_pol      jsonb := public.draft_start_policy();
  v_actual   jsonb;
  v_prev     public.draft_start_watch%rowtype;
  v_same     boolean;
  v_blocked  boolean;
  v_became   boolean;
  v_became_notify boolean;
  v_remind   boolean;
  v_in_rem   boolean;
  v_gate     timestamptz;
  v_notified text;
begin
  -- FOR NO KEY UPDATE (not SHARE): two overlapping sweeps judging the same
  -- league serialize here, so a first verdict can't warn twice.
  select * into v_l from public.leagues where id = p_league_id for no key update;
  if not found or v_l.draft_status <> 'not_started' or v_l.draft_date is distinct from p_draft_date
     or exists (select 1 from public.draft_postponements x where x.league_id = p_league_id) then
    return jsonb_build_object('status', 'stale');
  end if;

  v_actual := public._draft_start_inputs(p_league_id);
  if p_expect is null or v_actual is distinct from p_expect then
    return jsonb_build_object('status', 'changed');
  end if;

  select * into v_prev from public.draft_start_watch where league_id = p_league_id for update;
  v_same    := found and v_prev.draft_date = p_draft_date;
  v_blocked := coalesce(p_blocked, case when v_same then v_prev.blocked else false end);
  v_became  := p_blocked is true and not (v_same and v_prev.blocked);
  v_in_rem  := now() >= p_draft_date - make_interval(secs => (v_pol->>'reminder_lead_s')::int);
  v_remind  := p_blocked is true and not v_became and v_in_rem
               and v_same and v_prev.reminded_at is null;
  v_gate := case
    when v_same and v_prev.gate_cleared_at is not null then v_prev.gate_cleared_at
    when p_gate and (p_blocked is false
                     or (p_blocked is null
                         and now() >= p_draft_date - make_interval(secs => (v_pol->>'room_lead_s')::int)))
      then now()
  end;

  insert into public.draft_start_watch as w
    (league_id, draft_date, inputs_sig, evaluated_at, blocked, blockers, blocked_since,
     reminded_at, gate_cleared_at, room_opened_at)
  values (
    p_league_id, p_draft_date,
    -- An UNKNOWN verdict judged nothing: keep the old signature (or none), so
    -- the next tick re-evaluates instead of trusting a stale verdict.
    case when p_blocked is not null then md5(v_actual::text)
         when v_same then v_prev.inputs_sig
         else 'unknown' end,
    now(), v_blocked,
    case when p_blocked is null and v_same then v_prev.blockers else coalesce(p_blockers, '[]'::jsonb) end,
    case when not v_blocked then null
         when v_same and v_prev.blocked then v_prev.blocked_since
         else now() end,
    case when v_became and v_in_rem then now()
         when v_remind then now()
         when v_same then v_prev.reminded_at end,
    v_gate,
    case when v_same then v_prev.room_opened_at end)
  on conflict (league_id) do update set
    draft_date      = excluded.draft_date,
    inputs_sig      = excluded.inputs_sig,
    evaluated_at    = excluded.evaluated_at,
    blocked         = excluded.blocked,
    blockers        = excluded.blockers,
    blocked_since   = excluded.blocked_since,
    reminded_at     = excluded.reminded_at,
    gate_cleared_at = excluded.gate_cleared_at,
    room_opened_at  = excluded.room_opened_at;

  -- A league that flaps (prices drifting across the budget line, a join/leave
  -- loop) warns at most once an hour; the reminder is once per episode anyway.
  if v_became and exists (select 1 from public.league_notifications x
                           where x.league_id = p_league_id and x.kind = 'draft_at_risk'
                             and x.created_at > now() - interval '1 hour') then
    v_became_notify := false;
  else
    v_became_notify := v_became;
  end if;
  if (v_became_notify or v_remind) and v_l.commissioner_id is not null and v_l.commissioner_id not like 'bot-%' then
    insert into public.league_notifications (league_id, user_id, kind)
    values (p_league_id, v_l.commissioner_id,
            case when v_became_notify then 'draft_at_risk' else 'draft_at_risk_reminder' end);
    v_notified := case when v_became_notify then 'at_risk' else 'reminder' end;
  end if;

  return jsonb_build_object('status', 'recorded', 'blocked', v_blocked, 'notified', v_notified,
                            'gate_cleared', v_gate is not null);
end;
$$;

revoke all on function public.record_draft_watch(uuid, timestamptz, jsonb, boolean, jsonb, boolean) from public;
revoke all on function public.record_draft_watch(uuid, timestamptz, jsonb, boolean, jsonb, boolean) from anon, authenticated;
grant execute on function public.record_draft_watch(uuid, timestamptz, jsonb, boolean, jsonb, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 7. postpone_league_draft — the draft can't happen at this time
-- ---------------------------------------------------------------------------
-- The row FIRST, then clear draft_date (so #67's BEFORE UPDATE trigger, which
-- finalizes a league past its OLD finalize instant, sees nothing due once the
-- date is NULL, and #126's leave lock re-opens), then tell every human member.
-- p_draft_date is the time the caller judged: a league whose time moved since
-- is 'stale' and untouched.
create or replace function public.postpone_league_draft(
  p_league_id  uuid,
  p_draft_date timestamptz,
  p_stage      text,
  p_reason     text,
  p_blockers   jsonb,
  p_expect     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_l public.leagues%rowtype;
begin
  select * into v_l from public.leagues where id = p_league_id for update;
  if not found then
    return jsonb_build_object('status', 'refused', 'reason', 'league_not_found');
  end if;
  if v_l.draft_status <> 'not_started' then
    return jsonb_build_object('status', 'already_started', 'draft_status', v_l.draft_status);
  end if;
  if exists (select 1 from public.draft_postponements x where x.league_id = p_league_id) then
    return jsonb_build_object('status', 'already_postponed');
  end if;
  if v_l.draft_date is null or v_l.draft_date is distinct from p_draft_date then
    return jsonb_build_object('status', 'stale');
  end if;
  if p_stage not in ('room_open', 'start') then
    return jsonb_build_object('status', 'refused', 'reason', 'bad_stage');
  end if;
  -- CAS (supabase review #5): a join or fix landing during the caller's
  -- evaluation must not postpone a league that is no longer blocked. NULL =
  -- the caller could not read the slots (its blocker came from the rest).
  -- (A JSON null from PostgREST may arrive as jsonb 'null', not SQL NULL: only an object is an expectation.)
  if jsonb_typeof(p_expect) = 'object' and public._draft_start_inputs(p_league_id) is distinct from p_expect then
    return jsonb_build_object('status', 'changed');
  end if;

  insert into public.draft_postponements (league_id, postponed_from, stage, reason, blockers)
  values (p_league_id, v_l.draft_date, p_stage, coalesce(p_reason, 'blocked'), coalesce(p_blockers, '[]'::jsonb));

  update public.leagues set draft_date = null where id = p_league_id;
  delete from public.draft_start_watch where league_id = p_league_id;

  -- Flood guard (security review M1): set a time 55 min out on a blocked
  -- league, get postponed at the next tick, repeat. Each postponement is real,
  -- but members hear about it at most once an hour per league (the lobby
  -- always shows the current state).
  insert into public.league_notifications (league_id, user_id, kind)
  select p_league_id, m.user_id, 'draft_postponed'
    from public.league_members m
   where m.league_id = p_league_id and m.user_id not like 'bot-%'
     and not exists (select 1 from public.league_notifications x
                      where x.league_id = p_league_id and x.user_id = m.user_id
                        and x.kind = 'draft_postponed' and x.created_at > now() - interval '1 hour');

  return jsonb_build_object('status', 'postponed');
end;
$$;

revoke all on function public.postpone_league_draft(uuid, timestamptz, text, text, jsonb, jsonb) from public;
revoke all on function public.postpone_league_draft(uuid, timestamptz, text, text, jsonb, jsonb) from anon, authenticated;
grant execute on function public.postpone_league_draft(uuid, timestamptz, text, text, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 8. due_draft_starts — leagues at or past their draft time
-- ---------------------------------------------------------------------------
-- No upper bound: a league past its time either starts, or is postponed by the
-- start pass (blocked, the room never opened, or a start that kept failing for
-- START_RETRY_SECONDS). Nothing stays in limbo. Postponed leagues (including
-- the legacy backfill above) are never listed.
create or replace function public.due_draft_starts()
returns table (league_id uuid, draft_date timestamptz)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select l.id, l.draft_date
    from public.leagues l
   where l.draft_status = 'not_started'
     and l.draft_date is not null
     and l.draft_date <= now()
     and not exists (select 1 from public.draft_postponements x where x.league_id = l.id)
   order by l.draft_date, l.id;
$$;

revoke all on function public.due_draft_starts() from public;
revoke all on function public.due_draft_starts() from anon, authenticated;
grant execute on function public.due_draft_starts() to service_role;

-- ---------------------------------------------------------------------------
-- 9. start_league_draft — THE flip
-- ---------------------------------------------------------------------------
-- Row lock; not postponed; draft_date reached; the ROOM OPENED for this draft
-- time (the >= 1 h notice went out: otherwise the caller postpones); a rules
-- floor (defense in depth: the rule source is computeStartBlockers in
-- draft-control/rules.ts); the compare-and-swap against the inputs the caller
-- judged; then the flip (every existing start trigger fires). 22023 gates
-- raised BY NAME for every role (#126 roster_reconfirm_required, #94
-- renewal_replies_pending) come back as 'blocked'; any other error re-raises.
create or replace function public.start_league_draft(p_league_id uuid, p_expect jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_l       public.leagues%rowtype;
  v_actual  jsonb;
  v_members integer;
  v_gate    text;
begin
  -- Serializes with joins/leaves (FOR NO KEY UPDATE), the watch (FOR SHARE),
  -- postponement and other starters (FOR UPDATE).
  select * into v_l from public.leagues where id = p_league_id for update;
  if not found then
    return jsonb_build_object('status', 'refused', 'reason', 'league_not_found');
  end if;
  if v_l.draft_status <> 'not_started' then
    return jsonb_build_object('status', 'already_started', 'draft_status', v_l.draft_status);
  end if;
  if exists (select 1 from public.draft_postponements x where x.league_id = p_league_id) then
    return jsonb_build_object('status', 'postponed');
  end if;
  if v_l.draft_date is null or v_l.draft_date > now() then
    return jsonb_build_object('status', 'not_due');
  end if;
  if not exists (select 1 from public.draft_start_watch w
                  where w.league_id = p_league_id and w.draft_date = v_l.draft_date
                    and w.room_opened_at is not null) then
    return jsonb_build_object('status', 'room_not_open');
  end if;

  select count(*)::int into v_members from public.league_members m where m.league_id = p_league_id;
  if v_l.stake_mode is null then
    return jsonb_build_object('status', 'blocked', 'reason', 'no_stake_mode');
  end if;
  if v_members < 4 then
    return jsonb_build_object('status', 'blocked', 'reason', 'not_enough_members');
  end if;
  if v_l.league_type = 'matchup' and (v_l.playoff_teams is null or v_l.playoff_teams < 2) then
    return jsonb_build_object('status', 'blocked', 'reason', 'invalid_playoff_teams');
  end if;
  if v_l.league_type = 'matchup' and v_l.playoff_teams > v_members then
    return jsonb_build_object('status', 'blocked', 'reason', 'playoff_teams_exceeds_members');
  end if;

  v_actual := public._draft_start_inputs(p_league_id);
  if p_expect is null or v_actual is distinct from p_expect then
    return jsonb_build_object('status', 'changed', 'actual', v_actual);
  end if;

  begin
    update public.leagues set draft_status = 'in_progress' where id = p_league_id;
  exception when sqlstate '22023' then
    v_gate := split_part(sqlerrm, ':', 1);
    if v_gate in ('roster_reconfirm_required', 'renewal_replies_pending') then
      return jsonb_build_object('status', 'blocked', 'reason', v_gate);
    end if;
    raise;
  end;

  delete from public.draft_start_watch where league_id = p_league_id;

  -- Everyone in the (now locked) order who has a device to tell.
  insert into public.league_notifications (league_id, user_id, kind)
  select o.league_id, o.user_id, 'draft_started'
    from public.league_draft_order o
   where o.league_id = p_league_id and o.user_id not like 'bot-%';

  return jsonb_build_object('status', 'started');
end;
$$;

comment on function public.start_league_draft(uuid, jsonb) is
  'Draft auto-start: THE flip from not_started to in_progress (20261111000000). Row lock, not postponed, draft_date reached, the room opened, a rules floor, and a compare-and-swap against the inputs the caller judged. Writes the draft_started notices. Service role only.';

revoke all on function public.start_league_draft(uuid, jsonb) from public;
revoke all on function public.start_league_draft(uuid, jsonb) from anon, authenticated;
grant execute on function public.start_league_draft(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 10. open_due_draft_rooms — the T-1h notice (run by draft-order-notify)
-- ---------------------------------------------------------------------------
-- For every league the gate cleared whose room time has come: finalize the
-- order (#67's own path, gated by its 4-member / #126 reconfirm rules) and,
-- once it is set, tell every human in it. Then every late joiner (joins stay
-- open until the draft starts) who has no notice for THIS opening gets one.
-- Idempotent: room_opened_at is the dedupe; overlapping runs serialize on the
-- league row (_draft_order_sync locks it) and the conditional watch UPDATE.
create or replace function public.open_due_draft_rooms()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r       record;
  v_state text;
  n       integer := 0;
begin
  -- One run at a time (overlapping cron posts): the late-joiner insert below has
  -- no unique key to lean on.
  perform pg_advisory_xact_lock(hashtextextended('open_due_draft_rooms', 0));
  for r in
    select l.id, l.draft_date
      from public.leagues l
      join public.draft_start_watch w on w.league_id = l.id and w.draft_date = l.draft_date
     where l.draft_status = 'not_started'
       and now() >= l.draft_date - make_interval(secs => (public.draft_start_policy()->>'room_lead_s')::int)
       and w.gate_cleared_at is not null
       and w.room_opened_at is null
       and not exists (select 1 from public.draft_postponements x where x.league_id = l.id)
     order by l.draft_date, l.id
     limit 100
  loop
    perform public._draft_order_sync(r.id, true);   -- takes the league row lock
    select state into v_state from public.league_draft_order_meta where league_id = r.id;
    if v_state = 'finalized' then
      update public.draft_start_watch set room_opened_at = now()
       where league_id = r.id and draft_date = r.draft_date and room_opened_at is null;
      if found then
        insert into public.league_notifications (league_id, user_id, kind)
        select o.league_id, o.user_id, 'draft_room_open'
          from public.league_draft_order o
         where o.league_id = r.id and o.user_id not like 'bot-%';
        n := n + 1;
      end if;
    else
      -- Cleared, but the order could not be set (a leave in the last seconds
      -- before T-1h, #126's reconfirm): hand it back to the gate, which judges
      -- it again and postpones it now, with its real reason, not at T.
      update public.draft_start_watch set gate_cleared_at = null
       where league_id = r.id and draft_date = r.draft_date and room_opened_at is null;
    end if;
  end loop;

  -- Late joiners: in the order, human, and no 'draft_room_open' since this opening.
  insert into public.league_notifications (league_id, user_id, kind)
  select o.league_id, o.user_id, 'draft_room_open'
    from public.draft_start_watch w
    join public.leagues l on l.id = w.league_id and l.draft_date = w.draft_date
    join public.league_draft_order o on o.league_id = w.league_id
   where l.draft_status = 'not_started'
     and w.room_opened_at is not null
     and o.user_id not like 'bot-%'
     and not exists (select 1 from public.league_notifications x
                      where x.league_id = o.league_id and x.user_id = o.user_id
                        and x.kind = 'draft_room_open' and x.created_at >= w.room_opened_at);
  return n;
end;
$$;

revoke all on function public.open_due_draft_rooms() from public;
revoke all on function public.open_due_draft_rooms() from anon, authenticated;
grant execute on function public.open_due_draft_rooms() to service_role;

-- The notify cron's post guard (20261111000003): a room due to open, a late
-- joiner owed a notice, or a pending (or stale 'sending') push of a kind
-- draft-order-notify DELIVERS. Deliberately not #126's draft_order_notify_due():
-- that one is true for ANY pending kind but member_left (e.g. #94's renewal_*,
-- which another function delivers), so it could post every minute forever.
create or replace function public.draft_room_notices_due()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (
           select 1
             from public.leagues l
             join public.draft_start_watch w on w.league_id = l.id and w.draft_date = l.draft_date
            where l.draft_status = 'not_started'
              and now() >= l.draft_date - make_interval(secs => (public.draft_start_policy()->>'room_lead_s')::int)
              and w.gate_cleared_at is not null
              and w.room_opened_at is null
              and not exists (select 1 from public.draft_postponements x where x.league_id = l.id))
      or exists (
           select 1
             from public.draft_start_watch w
             join public.leagues l on l.id = w.league_id and l.draft_date = w.draft_date
             join public.league_draft_order o on o.league_id = w.league_id
            where l.draft_status = 'not_started'
              and w.room_opened_at is not null
              and o.user_id not like 'bot-%'
              and not exists (select 1 from public.league_notifications x
                               where x.league_id = o.league_id and x.user_id = o.user_id
                                 and x.kind = 'draft_room_open' and x.created_at >= w.room_opened_at))
      or exists (
           select 1 from public.league_notifications n
            where n.kind in ('draft_room_open', 'draft_started', 'draft_at_risk', 'draft_at_risk_reminder',
                             'draft_postponed', 'draft_time_set')   -- = plan.ts DELIVERED_KINDS
              and (n.push_status = 'pending'
                   or (n.push_status = 'sending' and n.push_attempted_at < now() - interval '10 minutes')));
$$;

revoke all on function public.draft_room_notices_due() from public;
revoke all on function public.draft_room_notices_due() from anon, authenticated;
grant execute on function public.draft_room_notices_due() to service_role;

-- ---------------------------------------------------------------------------
-- 11. draft_notice_context — what draft-order-notify needs to word a push
-- ---------------------------------------------------------------------------
-- Read at SEND time (positions, names and state move), from verified rows only:
-- the push copy is built server-side (send-notification's closed-set rule).
-- participant_display_name is internal (no API role), hence DEFINER.
create or replace function public.draft_notice_context(p_notice_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'kind',              n.kind,
    'league_id',         n.league_id,
    'user_id',           n.user_id,
    'created_at',        n.created_at,
    'league_name',       l.name,
    'draft_status',      l.draft_status,
    'draft_date',        l.draft_date,
    'draft_order_mode',  l.draft_order_mode,
    'is_member',         exists (select 1 from public.league_members m
                                  where m.league_id = n.league_id and m.user_id = n.user_id),
    'is_commissioner',   l.commissioner_id = n.user_id,
    'commissioner_name', public.participant_display_name(l.commissioner_id),
    'position',          (select o.position from public.league_draft_order o
                           where o.league_id = n.league_id and o.user_id = n.user_id),
    -- 'draft_time_set': has this member been told a draft time for this league
    -- before? ("The draft is now ..." vs the first-set "The draft is set for ...")
    'told_time_before',  exists (select 1 from public.league_notifications x
                                  where x.league_id = n.league_id and x.user_id = n.user_id
                                    and x.kind = 'draft_time_set' and x.id <> n.id
                                    and x.push_status in ('sent', 'no_device', 'failed')),
    'watch',             (select jsonb_build_object('draft_date', w.draft_date, 'blocked', w.blocked,
                                                    'blockers', w.blockers, 'room_opened_at', w.room_opened_at)
                            from public.draft_start_watch w where w.league_id = n.league_id),
    'postponement',      (select jsonb_build_object('postponed_from', p.postponed_from, 'stage', p.stage,
                                                    'reason', p.reason, 'blockers', p.blockers)
                            from public.draft_postponements p where p.league_id = n.league_id))
    from public.league_notifications n
    join public.leagues l on l.id = n.league_id
   where n.id = p_notice_id
$$;

revoke all on function public.draft_notice_context(uuid) from public;
revoke all on function public.draft_notice_context(uuid) from anon, authenticated;
grant execute on function public.draft_notice_context(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- POST-PUSH CHECKS (HUMAN ACTION; the effect block is
-- docs/security/draft-auto-start-effect-test.sql):
--   SELECT proname, proacl, prosecdef, proconfig FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND proname IN ('draft_start_policy','_draft_start_inputs',
--      'draft_watch_due','record_draft_watch','postpone_league_draft','due_draft_starts',
--      'start_league_draft','open_due_draft_rooms','draft_room_notices_due','draft_notice_context');
--   -- every proacl: postgres + service_role only (no anon=, no authenticated=, no =X)
--   SELECT relname, relrowsecurity, relacl FROM pg_class
--    WHERE oid IN ('public.draft_start_watch'::regclass, 'public.draft_postponements'::regclass);
--   SELECT stage, count(*) FROM draft_postponements GROUP BY stage;   -- the legacy backfill
-- ---------------------------------------------------------------------------
