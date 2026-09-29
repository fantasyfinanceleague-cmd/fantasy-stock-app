-- ============================================================================
-- DRAFT ORDER MODES — a STORED draft order, random or manual, never
-- commissioner-first by default. Finalized at draft_date − 1h; locked at start.
-- ============================================================================
-- PRODUCT RULE (Giorgio, 2026-09-29): the draft order is a per-league setting
-- with two modes and is NEVER automatically commissioner-first.
--   random — the SERVER randomizes the order and reveals it at
--            draft_date − 1h (not at start), final from that instant.
--   manual — the commissioner arranges the order (seeded with a random order,
--            never commissioner-first) and may edit it / switch mode until
--            draft_date − 1h, when it is finalized as-is.
-- "T−1h" is precisely the LATER of draft_date − 1h and the league reaching 4
-- members (MIN_DRAFT_MEMBERS): finalizing a 1–3 member order and appending the
-- rest in join order would put the commissioner first (see _draft_order_sync).
-- Late joiners after the T−1h finalize are APPENDED (every announced slot is
-- preserved); a leaver is removed and the gap closed. At draft start the order
-- is LOCKED: fully immutable, even to the service role. Leaving the league
-- mid-draft is refused. At finalize every human member gets a
-- "draft order is set" notice (league_notifications); the push is sent by
-- draft-order-notify (cron in deferred/20261013000001).
--
-- BEFORE THIS: computeDraftOrder (supabase/functions/_shared/draft-validation.ts)
-- DERIVED the order on every call — commissioner first, the rest sorted by id —
-- and both clients re-derived it. Every caller now reads league_draft_order.
--
-- STATE (league_draft_order_meta.state — an explicit discriminator, never
-- inferred from which timestamps are NULL):
--   (no meta row)  random mode before the reveal: no order exists yet.
--   open           materialized and editable (manual mode only, pre T−1h).
--   finalized      T−1h passed: no reordering. APPEND (a late joiner) and
--                  remove+close-gap (a leaver) only.
--   locked         the draft started: immutable. Joins and mid-draft leaves
--                  are refused.
-- Transitions only run forward (open→finalized→locked, or open→locked at a
-- start that beat the finalize). A row trigger enforces the finalized/locked
-- write rules on league_draft_order for EVERY role, service_role included
-- (BYPASSRLS does not bypass triggers).
--
-- "EFFECTIVELY FINALIZED" IS TIME-BASED, NOT FLAG-BASED. Nothing depends on
-- the cron having flipped `state`: every write path (set_draft_order, a mode
-- change, a draft_date change, a join, get_draft_order, draft start) first
-- finalizes a league whose draft_date − 1h has passed, under the league row
-- lock. The cron only guarantees the finalize — and so the notice — happens on
-- time for a league nobody opened.
--
-- RANDOMNESS: gen_random_uuid() (pg_strong_random) inside
-- _draft_order_materialize, which no API role can execute. A client can never
-- choose, see early, or reroll a random order: it is generated EXACTLY ONCE,
-- under the leagues row lock (FOR NO KEY UPDATE — serializes with
-- join_league_by_code's FOR UPDATE and the start UPDATE, without deadlocking
-- against the league_members FK's KEY SHARE), and the meta PRIMARY KEY is the
-- backstop: the order rows are written only if THIS call's meta INSERT won.
--
-- WHY SEPARATE TABLES, NOT leagues.draft_order text[]: [I2a]
-- leagues_update_commissioner gives the commissioner whole-row UPDATE on
-- leagues, so an order (or a lock flag) stored there could be rewritten over
-- PostgREST past every check. No API role has write grants on the tables below;
-- only the SECURITY DEFINER functions here write them.
--
-- BACKFILL (Orchestrator decision (d)): every league whose draft has STARTED
-- (in_progress — incl. test_07_05_26 — AND completed) gets its CURRENT derived
-- order VERBATIM (commissioner first if a member, then user_id COLLATE "C" =
-- byte order = JS .sort() code-unit order for ASCII ids), mode 'legacy', state
-- 'locked'. So the invariant "draft started => a locked order exists" holds for
-- every league and readers never branch on a missing order. Turn math cannot
-- shift mid-draft. Caveat: a completed league whose membership changed since it
-- finished gets its CURRENT members — labeled legacy for that reason.
--
-- READ-ONLY PRE-CHECK (HUMAN ACTION — run BEFORE `db push`):
--   SELECT l.id, l.name, l.draft_status, l.commissioner_id, l.draft_date,
--          count(m.user_id) AS members,
--          (SELECT count(*) FROM drafts d WHERE d.league_id = l.id) AS picks,
--          bool_and(m.user_id ~ '^[\x21-\x7e]+$') AS ids_ascii,
--          array_agg(m.user_id ORDER BY (m.user_id = l.commissioner_id) DESC,
--                    m.user_id COLLATE "C") AS backfill_order,
--          (SELECT array_agg(d.user_id ORDER BY d.pick_number) FROM drafts d
--            WHERE d.league_id = l.id AND d.round = 1) AS round1_actual
--     FROM leagues l JOIN league_members m ON m.league_id = l.id
--    GROUP BY l.id ORDER BY l.draft_status, l.name;
--   STOP unless: ids_ascii is true on every row, and for every in_progress
--   league round1_actual is a prefix of backfill_order.
--   And list what section 11 will finalize SILENTLY at push (no notice):
--   SELECT l.id, l.name, l.draft_date, count(m.user_id) AS members
--     FROM leagues l JOIN league_members m ON m.league_id = l.id
--    WHERE coalesce(l.draft_status,'not_started') = 'not_started'
--      AND l.draft_date IS NOT NULL AND now() >= l.draft_date - interval '1 hour'
--    GROUP BY l.id HAVING count(m.user_id) >= 4;
--   Expected: only stale/abandoned leagues. A REAL league drafting within the
--   hour of the push would get its order set without a push — push at a
--   quiet time, or tell its members.
--   Also confirm no not_started league is due to START between this push and
--   the edge deploy (old edge code still derives commissioner-first).
--
-- GRANTS (CLAUDE.md "Postgres function grants"): REVOKE ... FROM PUBLIC does
-- not clear Supabase's explicit anon/authenticated/service_role default
-- grants, so every function and table below revokes BY ROLE NAME. proacl /
-- relacl queries at the bottom; never assume.
--
-- HUMAN ACTION: supabase db push, from the deploy checkout only (CLAUDE.md),
-- then IMMEDIATELY deploy validate-and-record-pick, draft-autopick-sweep,
-- draft-control and draft-order-notify, then run
-- docs/security/draft-order-modes-effect-test.sql in the SQL editor.
-- ============================================================================

-- ===========================================================================
-- 1. leagues.draft_order_mode
-- ===========================================================================
alter table public.leagues
  add column if not exists draft_order_mode text not null default 'random';

alter table public.leagues drop constraint if exists leagues_draft_order_mode_check;
alter table public.leagues add constraint leagues_draft_order_mode_check
  check (draft_order_mode in ('random', 'manual', 'legacy'));

comment on column public.leagues.draft_order_mode is
  'Explicit discriminator for how the draft order was chosen. random (default): server-randomized, revealed and final at draft_date - 1h. manual: arranged by the commissioner until draft_date - 1h. legacy: backfilled by 20261013000000 for drafts that had already started (the old derived commissioner-first order). Clients may set random/manual (trg_leagues_order_mode enforces when); legacy is never client-writable.';

-- ===========================================================================
-- 2. Tables
-- ===========================================================================
create table if not exists public.league_draft_order_meta (
  league_id           uuid primary key references public.leagues(id) on delete cascade,
  state               text not null,
  source              text not null,
  materialized_at     timestamptz not null default now(),
  last_edited_at      timestamptz,
  finalized_at        timestamptz,
  locked_at           timestamptz,
  reconciled_at_start boolean not null default false,
  constraint league_draft_order_meta_state_check
    check (state in ('open', 'finalized', 'locked')),
  constraint league_draft_order_meta_source_check
    check (source in ('random', 'manual_seed', 'start_backstop', 'legacy_backfill')),
  -- The stamps must agree with the discriminator (never the other way round).
  constraint league_draft_order_meta_stamps_check check (
       (state = 'open'      and finalized_at is null     and locked_at is null)
    or (state = 'finalized' and finalized_at is not null and locked_at is null)
    or (state = 'locked'    and finalized_at is not null and locked_at is not null))
);

comment on table public.league_draft_order_meta is
  'One row per league whose draft order exists. state is the discriminator: open (editable, manual only) / finalized (draft_date - 1h passed: append/remove only) / locked (draft started: immutable). Written only by the SECURITY DEFINER draft-order functions.';

create table if not exists public.league_draft_order (
  league_id uuid not null references public.league_draft_order_meta(league_id) on delete cascade,
  position  integer not null,
  user_id   text not null,   -- text, like league_members.user_id / drafts.user_id; bots are 'bot-*'
  constraint league_draft_order_position_check check (position >= 1),
  -- DEFERRABLE: closing a leaver's gap shifts positions down one row at a time.
  constraint league_draft_order_pkey primary key (league_id, position) deferrable initially deferred,
  constraint league_draft_order_user_unique unique (league_id, user_id)
);

comment on table public.league_draft_order is
  'The stored draft order: position 1..n, one row per member (bots included). Snake turn math reads it in supabase/functions/_shared/draft-validation.ts; nothing derives an order any more.';

create table if not exists public.league_notifications (
  id                uuid primary key default gen_random_uuid(),
  league_id         uuid not null references public.leagues(id) on delete cascade,
  user_id           text not null,
  kind              text not null,
  created_at        timestamptz not null default now(),
  push_status       text not null default 'pending',
  push_attempts     smallint not null default 0,
  push_attempted_at timestamptz,
  push_error        text,
  constraint league_notifications_kind_check check (kind in ('draft_order_set')),
  constraint league_notifications_push_status_check
    check (push_status in ('pending', 'sending', 'sent', 'no_device', 'skipped', 'failed'))
);

comment on table public.league_notifications is
  'In-app notice record, one row per (recipient, event); owner-only SELECT. Rows are INSERTed only by the draft-order SECURITY DEFINER functions, in the same transaction as the event. push_* is the delivery state, written only by the draft-order-notify edge function (service role): pending -> sending -> sent | no_device (no token, or notifications disabled) | skipped (no longer a member / not in the order) | failed.';

-- Exactly one "order is set" notice per member per league, however many paths
-- finalize (lazy read, cron, start backstop, a join after finalize).
create unique index if not exists league_notifications_draft_order_set_uidx
  on public.league_notifications (league_id, user_id) where kind = 'draft_order_set';
create index if not exists league_notifications_user_idx
  on public.league_notifications (user_id, created_at desc);
create index if not exists league_notifications_push_open_idx
  on public.league_notifications (push_status, push_attempted_at)
  where push_status in ('pending', 'sending');

-- ===========================================================================
-- 3. Backfill (BEFORE any trigger below exists)
-- ===========================================================================
update public.leagues
   set draft_order_mode = 'legacy'
 where coalesce(draft_status, 'not_started') <> 'not_started'
   and draft_order_mode <> 'legacy';

insert into public.league_draft_order_meta
  (league_id, state, source, materialized_at, finalized_at, locked_at)
select l.id, 'locked', 'legacy_backfill', now(), now(), now()
  from public.leagues l
 where coalesce(l.draft_status, 'not_started') <> 'not_started'
on conflict (league_id) do nothing;

-- VERBATIM computeDraftOrder: commissioner first (only if a member), then the
-- rest ascending by user_id in byte order.
insert into public.league_draft_order (league_id, position, user_id)
select m.league_id,
       row_number() over (partition by m.league_id
                          order by (m.user_id = l.commissioner_id) desc, m.user_id collate "C"),
       m.user_id
  from public.league_members m
  join public.leagues l on l.id = m.league_id
 where coalesce(l.draft_status, 'not_started') <> 'not_started'
   and not exists (select 1 from public.league_draft_order o where o.league_id = m.league_id);

-- ===========================================================================
-- 4. Internal helpers — no API role may execute any of these
-- ===========================================================================
create or replace function public._draft_order_is_due(p_draft_date timestamptz)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select p_draft_date is not null and now() >= p_draft_date - interval '1 hour';
$$;

-- Create the order ONCE: meta (state open) + a random permutation of the
-- current members. Caller holds the leagues row lock. Returns true iff THIS
-- call created it; a lost race (or an existing order) writes nothing.
create or replace function public._draft_order_materialize(p_league_id uuid, p_source text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_created uuid;
begin
  insert into public.league_draft_order_meta (league_id, state, source)
  values (p_league_id, 'open', p_source)
  on conflict (league_id) do nothing
  returning league_id into v_created;
  if v_created is null then
    return false;
  end if;

  insert into public.league_draft_order (league_id, position, user_id)
  select p_league_id, row_number() over (order by r.k), r.user_id
    from (select m.user_id, gen_random_uuid() as k
            from public.league_members m
           where m.league_id = p_league_id) r;
  return true;
end;
$$;

-- One "order is set" notice per human member in the order (bots have no
-- device and no inbox). Idempotent.
create or replace function public._draft_order_notify_members(p_league_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.league_notifications (league_id, user_id, kind)
  select o.league_id, o.user_id, 'draft_order_set'
    from public.league_draft_order o
   where o.league_id = p_league_id
     and o.user_id not like 'bot-%'
  on conflict (league_id, user_id) where kind = 'draft_order_set' do nothing;
$$;

-- open -> finalized (materializing first if no order exists). Caller holds
-- the leagues row lock. EVERY finalize creates the "order is set" notice —
-- at T−1h, when the 4th member joins, or at the start backstop (Orchestrator
-- decision 2026-09-29: keep the start-time notice). The one exception is the
-- one-off sweep at the bottom of THIS migration, which finalizes leagues that
-- were already past due when it was pushed without notifying anyone, so the
-- first cron tick does not push about abandoned test leagues.
create or replace function public._draft_order_finalize(p_league_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_l     public.leagues%rowtype;
  v_state text;
begin
  select * into v_l from public.leagues where id = p_league_id;
  if not found then
    return false;
  end if;

  select state into v_state from public.league_draft_order_meta where league_id = p_league_id;
  if v_state is null then
    perform public._draft_order_materialize(
      p_league_id, case when v_l.draft_order_mode = 'manual' then 'manual_seed' else 'random' end);
    -- Re-read, never assume 'open': if a concurrent caller won the
    -- materialize (only reachable without the leagues row lock, which every
    -- current caller holds), its state is the truth (supabase-reviewer).
    select state into v_state from public.league_draft_order_meta where league_id = p_league_id;
  end if;
  if v_state is distinct from 'open' then
    return false;
  end if;

  update public.league_draft_order_meta
     set state = 'finalized', finalized_at = now()
   where league_id = p_league_id and state = 'open';

  perform public._draft_order_notify_members(p_league_id);
  return true;
end;
$$;

-- Bring a NOT-STARTED league's order up to date with the clock:
--   due AND >= 4 members  -> finalize (materializing if needed)
--   manual, no order      -> seed a random order (never commissioner-first)
--   otherwise             -> nothing (a random order stays unrevealed)
-- p_lock = false when the caller already holds the row (a leagues trigger, or
-- a function that locked it).
--
-- WHY THE MEMBER FLOOR (found by the no-commissioner-first regression test):
-- finalizing at T−1h with only the commissioner in the league (a league
-- created inside the hour, or read by its creator before anyone joined) would
-- randomize a one-person order and then APPEND everyone else in join order —
-- commissioner first, the exact outcome the product rule forbids. So the
-- finalize happens at the LATER of draft_date − 1h and the league reaching 4
-- members = MIN_DRAFT_MEMBERS (supabase/functions/draft-control/rules.ts), the
-- floor below which a draft cannot start anyway. Keep the two in step.
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
     and (select count(*) from public.league_members m where m.league_id = p_league_id) >= 4 then
    perform public._draft_order_finalize(p_league_id);
  elsif v_l.draft_order_mode = 'manual' then
    perform public._draft_order_materialize(p_league_id, 'manual_seed');
  end if;
end;
$$;

-- Is the stored order EXACTLY a permutation of the current members, with
-- positions 1..n? Compared per participant, both directions — never "does an
-- order exist" (CLAUDE.md partial-state family).
create or replace function public._draft_order_matches_members(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
           select o.user_id from public.league_draft_order o where o.league_id = p_league_id
           except
           select m.user_id from public.league_members m where m.league_id = p_league_id)
     and not exists (
           select m.user_id from public.league_members m where m.league_id = p_league_id
           except
           select o.user_id from public.league_draft_order o where o.league_id = p_league_id)
     and (select count(*) from public.league_draft_order o where o.league_id = p_league_id)
       = (select coalesce(max(o.position), 0) from public.league_draft_order o where o.league_id = p_league_id);
$$;

-- Deterministic reconcile to the current member set: drop non-members (the
-- rest keep their relative order), close gaps, append missing members by
-- joined_at then user_id. Given the membership triggers this is a no-op; it is
-- the defensive half of "the order is an exact permutation at start", and a
-- non-no-op is RECORDED (meta.reconciled_at_start), not silent. Appends go one
-- row at a time: the finalized-state row trigger accepts an INSERT only past
-- the current maximum position.
create or replace function public._draft_order_reconcile(p_league_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_changed boolean := false;
  v_n       integer;
  r         record;
begin
  delete from public.league_draft_order o
   where o.league_id = p_league_id
     and not exists (select 1 from public.league_members m
                      where m.league_id = p_league_id and m.user_id = o.user_id);
  get diagnostics v_n = row_count;
  v_changed := v_n > 0;

  update public.league_draft_order o
     set position = r2.rn
    from (select x.user_id, row_number() over (order by x.position) as rn
            from public.league_draft_order x where x.league_id = p_league_id) r2
   where o.league_id = p_league_id and o.user_id = r2.user_id and o.position <> r2.rn;
  get diagnostics v_n = row_count;
  v_changed := v_changed or v_n > 0;

  for r in
    select m.user_id
      from public.league_members m
     where m.league_id = p_league_id
       and not exists (select 1 from public.league_draft_order o
                        where o.league_id = p_league_id and o.user_id = m.user_id)
     order by m.joined_at, m.user_id collate "C"
  loop
    insert into public.league_draft_order (league_id, position, user_id)
    select p_league_id, coalesce(max(o.position), 0) + 1, r.user_id
      from public.league_draft_order o where o.league_id = p_league_id;
    v_changed := true;
  end loop;

  return v_changed;
end;
$$;

-- ===========================================================================
-- 5. Write-rule triggers on the order tables (every role, service_role too)
-- ===========================================================================
create or replace function public.enforce_league_draft_order_rows()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_league uuid := case when tg_op = 'DELETE' then old.league_id else new.league_id end;
  v_state  text;
begin
  select state into v_state from public.league_draft_order_meta where league_id = v_league;

  -- No meta (it is being cascaded away) or still open: free. The only writers
  -- are the definer functions in this migration.
  if v_state is null or v_state = 'open' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    -- A league delete cascades through here: allowed once the league is gone.
    if v_state = 'locked' and exists (select 1 from public.leagues where id = v_league) then
      raise exception 'draft_order_locked: the draft has started; the draft order cannot change'
        using errcode = '22023';
    end if;
    return old;   -- finalized: a leaver is removed
  end if;

  if v_state = 'locked' then
    raise exception 'draft_order_locked: the draft has started; the draft order cannot change'
      using errcode = '22023';
  end if;

  -- finalized: append past the end, or shift a row UP to close a gap. Nothing
  -- else — no reordering after draft_date − 1h.
  if tg_op = 'INSERT' then
    if exists (select 1 from public.league_draft_order
                where league_id = new.league_id and position >= new.position) then
      raise exception 'draft_order_finalized: after the order is set, members can only be appended'
        using errcode = '22023';
    end if;
    return new;
  end if;

  if new.league_id = old.league_id and new.user_id = old.user_id and new.position < old.position then
    return new;
  end if;
  raise exception 'draft_order_finalized: the draft order is set and cannot be rearranged'
    using errcode = '22023';
end;
$$;

drop trigger if exists trg_league_draft_order_rows on public.league_draft_order;
create trigger trg_league_draft_order_rows
  before insert or update or delete on public.league_draft_order
  for each row execute function public.enforce_league_draft_order_rows();

create or replace function public.enforce_league_draft_order_meta()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rank_old int;
  v_rank_new int;
begin
  if tg_op = 'DELETE' then
    -- Only an OPEN order may be discarded (manual -> random before T−1h), or
    -- any order once its league is gone (cascade).
    if old.state <> 'open' and exists (select 1 from public.leagues where id = old.league_id) then
      raise exception 'draft_order_locked: a % draft order cannot be discarded', old.state
        using errcode = '22023';
    end if;
    return old;
  end if;

  if old.state = 'locked' then
    raise exception 'draft_order_locked: the draft has started; the draft order cannot change'
      using errcode = '22023';
  end if;
  v_rank_old := case old.state when 'open' then 0 when 'finalized' then 1 else 2 end;
  v_rank_new := case new.state when 'open' then 0 when 'finalized' then 1 else 2 end;
  if v_rank_new < v_rank_old
     or new.league_id <> old.league_id
     or new.source <> old.source
     or new.materialized_at <> old.materialized_at
     or (old.finalized_at is not null and new.finalized_at is distinct from old.finalized_at) then
    raise exception 'draft_order_state: the draft order state only moves forward (open -> finalized -> locked)'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_league_draft_order_meta on public.league_draft_order_meta;
create trigger trg_league_draft_order_meta
  before update or delete on public.league_draft_order_meta
  for each row execute function public.enforce_league_draft_order_meta();

-- ===========================================================================
-- 6. leagues triggers: mode rules (BEFORE) and the start lock (AFTER)
-- ===========================================================================
-- Name sorts AFTER trg_leagues_member_update_columns ('m' < 'o'), so the
-- member column-guard refuses a non-commissioner's mode change before this
-- trigger does anything; and before trg_leagues_pick_clock ('o' < 'p').
-- Changes NEW never — it only refuses, finalizes, or discards an open order.
create or replace function public.enforce_leagues_draft_order_mode()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state text;
begin
  if tg_op = 'INSERT' then
    if new.draft_order_mode = 'legacy' then
      raise exception 'draft_order_mode_invalid: legacy is set only by the backfill'
        using errcode = '22023';
    end if;
    return new;
  end if;

  -- UPDATE. The T−1h promise holds even if nobody read the order and the cron
  -- is late: moving draft_date (or anything else) on a league already past
  -- its finalize instant first finalizes it at the OLD date. The row is
  -- already locked by this UPDATE, so no re-lock.
  if coalesce(old.draft_status, 'not_started') = 'not_started'
     and public._draft_order_is_due(old.draft_date) then
    perform public._draft_order_sync(old.id, false);
  end if;

  if new.draft_order_mode is not distinct from old.draft_order_mode then
    return new;
  end if;

  if new.draft_order_mode = 'legacy' or old.draft_order_mode = 'legacy'
     or coalesce(old.draft_status, 'not_started') <> 'not_started' then
    raise exception 'draft_order_mode_locked: the draft order mode cannot change once the draft has started'
      using errcode = '22023';
  end if;

  select state into v_state from public.league_draft_order_meta where league_id = old.id;
  if v_state = 'locked' then
    raise exception 'draft_order_mode_locked: the draft order mode cannot change once the draft has started'
      using errcode = '22023';
  end if;
  if v_state = 'finalized'
     or public._draft_order_is_due(old.draft_date)
     or public._draft_order_is_due(new.draft_date) then
    raise exception 'draft_order_reveal_passed: the draft order mode cannot change within 1 hour of the draft'
      using errcode = '22023';
  end if;

  -- manual -> random: discard the open manual order; the server reveals a
  -- fresh random one at T−1h. random -> manual: nothing exists yet (random
  -- orders are never materialized before T−1h); the first read seeds one.
  if new.draft_order_mode = 'random' then
    delete from public.league_draft_order_meta where league_id = old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leagues_order_mode on public.leagues;
create trigger trg_leagues_order_mode
  before insert or update on public.leagues
  for each row execute function public.enforce_leagues_draft_order_mode();

-- The start BACKSTOP and LOCK. AFTER UPDATE, so it covers every way a draft
-- starts: draft-control's conditional UPDATE and the commissioner's direct
-- [I2a] PostgREST flip (web handleStartDraft) alike. Invariant afterwards:
-- draft started => meta.state = 'locked' and the order is an exact
-- permutation of the members.
create or replace function public.lock_draft_order_on_start()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state   text;
  v_changed boolean;
begin
  select state into v_state from public.league_draft_order_meta where league_id = new.id;

  if v_state = 'locked' then
    -- A re-start of a league whose order is already locked (no product flow
    -- does this today; season 2 keeps draft_status completed). Keep the order
    -- only if it still fits the members exactly; never silently re-shuffle.
    if not public._draft_order_matches_members(new.id) then
      raise exception 'draft_order_locked_mismatch: this league''s locked draft order no longer matches its members'
        using errcode = '22023';
    end if;
    return null;
  end if;

  if v_state is null then
    perform public._draft_order_materialize(new.id, 'start_backstop');
  end if;
  perform public._draft_order_finalize(new.id);   -- no-op unless open
  v_changed := public._draft_order_reconcile(new.id);

  update public.league_draft_order_meta
     set state = 'locked', locked_at = now(), reconciled_at_start = v_changed
   where league_id = new.id;
  return null;
end;
$$;

drop trigger if exists trg_leagues_order_start on public.leagues;
create trigger trg_leagues_order_start
  after update of draft_status on public.leagues
  for each row
  -- ANY exit from not_started: draft-control / [I2a] -> in_progress, and a
  -- direct [I2a] jump to completed, which must lock the order too.
  when (coalesce(old.draft_status, 'not_started') = 'not_started'
        and coalesce(new.draft_status, 'not_started') <> 'not_started')
  execute function public.lock_draft_order_on_start();

-- ===========================================================================
-- 7. league_members trigger: keep the order an exact permutation
-- ===========================================================================
-- The ONE choke point for every membership writer (join_league_by_code,
-- insert_self, [I6] bots, draft-control add_bots, [I5] leave, a league delete).
--   join:  no order yet -> nothing (materialize will include them)
--          open, never edited (the manual seed) -> a uniformly random slot
--          open, edited by the commissioner / finalized -> append at the end
--          (+ their own notice if finalized); locked -> REFUSED.
--          A join that brings a due league to 4 members finalizes it here.
--   leave: open / finalized -> remove and close the gap;
--          locked + in_progress -> REFUSED (no leaving mid-draft);
--          locked + completed -> allowed, order kept as history.
create or replace function public.sync_draft_order_on_member_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_l     public.leagues%rowtype;
  v_state text;
  v_pos   integer;
  v_n     integer;
begin
  if tg_op = 'INSERT' then
    select * into v_l from public.leagues where id = new.league_id for no key update;
    if not found then
      return null;
    end if;
    perform public._draft_order_sync(new.league_id, false);   -- finalize if now due + 4 members (includes this member)

    select state into v_state from public.league_draft_order_meta where league_id = new.league_id;
    if v_state is null then
      return null;
    end if;
    if v_state = 'locked' then
      raise exception 'draft_order_locked: the draft has started, so the league cannot take new members'
        using errcode = '22023';
    end if;
    if exists (select 1 from public.league_draft_order
                where league_id = new.league_id and user_id = new.user_id) then
      return null;   -- the finalize above already included them
    end if;

    select count(*) into v_n from public.league_draft_order where league_id = new.league_id;
    if v_state = 'open'
       and (select m.last_edited_at is null from public.league_draft_order_meta m
             where m.league_id = new.league_id) then
      -- An UNEDITED seed stays a uniformly random permutation: insert the
      -- joiner at a uniformly random slot (a uniform permutation of n, with a
      -- new element placed uniformly among n+1 slots, is a uniform permutation
      -- of n+1). Appending here would put the commissioner — usually the seed's
      -- only member — first by default.
      -- Drawn from gen_random_uuid() (pg_strong_random), the same source as
      -- the initial shuffle — not random(). The first 8 hex digits of a v4
      -- uuid are all random bits; modulo bias over 2^32 is negligible.
      v_pos := 1 + (('x' || substr(gen_random_uuid()::text, 1, 8))::bit(32)::bigint % (v_n + 1))::integer;
      update public.league_draft_order
         set position = position + 1
       where league_id = new.league_id and position >= v_pos;
      insert into public.league_draft_order (league_id, position, user_id)
      values (new.league_id, v_pos, new.user_id);
    else
      -- The commissioner arranged it (open, edited) or it is set (finalized):
      -- append, so every placed or announced slot is preserved.
      insert into public.league_draft_order (league_id, position, user_id)
      values (new.league_id, v_n + 1, new.user_id);
      if v_state = 'finalized' and new.user_id not like 'bot-%' then
        insert into public.league_notifications (league_id, user_id, kind)
        values (new.league_id, new.user_id, 'draft_order_set')
        on conflict (league_id, user_id) where kind = 'draft_order_set' do nothing;
      end if;
    end if;
    return null;
  end if;

  -- DELETE
  select * into v_l from public.leagues where id = old.league_id for no key update;
  if not found then
    return null;   -- the league itself is being deleted (cascade)
  end if;
  select state into v_state from public.league_draft_order_meta where league_id = old.league_id;
  if v_state is null then
    return null;
  end if;
  if v_state = 'locked' then
    if coalesce(v_l.draft_status, 'not_started') = 'in_progress' then
      raise exception 'draft_in_progress: a member cannot leave the league while its draft is in progress'
        using errcode = '22023';
    end if;
    return null;
  end if;

  delete from public.league_draft_order
   where league_id = old.league_id and user_id = old.user_id
  returning position into v_pos;
  if v_pos is not null then
    update public.league_draft_order
       set position = position - 1
     where league_id = old.league_id and position > v_pos;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_league_members_draft_order on public.league_members;
create trigger trg_league_members_draft_order
  after insert or delete on public.league_members
  for each row execute function public.sync_draft_order_on_member_change();

-- ===========================================================================
-- 8. Client RPCs
-- ===========================================================================
-- get_draft_order — the ONE read path, and the lazy reveal. A member reads
-- the order and its state; a read at/after draft_date − 1h finalizes it (a
-- random order is generated right here, exactly once), and a manual league's
-- first read seeds its random starting order. The common read takes no lock.
create or replace function public.get_draft_order(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     text := auth.uid()::text;
  v_l       public.leagues%rowtype;
  v_m       public.league_draft_order_meta%rowtype;
  v_order   jsonb;
  v_started boolean;
  v_open    boolean;
  v_comm    boolean;
  v_members integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  if not exists (select 1 from public.league_members
                  where league_id = p_league_id and user_id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'not_a_member');
  end if;
  select * into v_l from public.leagues where id = p_league_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_a_member');
  end if;
  select * into v_m from public.league_draft_order_meta where league_id = p_league_id;

  v_started := coalesce(v_l.draft_status, 'not_started') <> 'not_started';
  if not v_started and (
       (v_m.league_id is null and (v_l.draft_order_mode = 'manual' or public._draft_order_is_due(v_l.draft_date)))
    or (v_m.state = 'open' and public._draft_order_is_due(v_l.draft_date))) then
    perform public._draft_order_sync(p_league_id, true);
    select * into v_l from public.leagues where id = p_league_id;
    select * into v_m from public.league_draft_order_meta where league_id = p_league_id;
  end if;

  select jsonb_agg(jsonb_build_object('position', o.position, 'user_id', o.user_id) order by o.position)
    into v_order
    from public.league_draft_order o where o.league_id = p_league_id;

  v_started := coalesce(v_l.draft_status, 'not_started') <> 'not_started';
  v_open := not v_started and coalesce(v_m.state, 'open') = 'open'
            and not public._draft_order_is_due(v_l.draft_date);
  v_comm := v_l.commissioner_id = v_uid;
  select count(*) into v_members from public.league_members where league_id = p_league_id;

  return jsonb_build_object(
    'ok', true,
    'mode', v_l.draft_order_mode,
    'state', coalesce(v_m.state, 'open'),
    'draft_date', v_l.draft_date,
    'finalize_at', v_l.draft_date - interval '1 hour',
    'revealed', v_order is not null,
    'revealed_at', v_m.materialized_at,
    'finalized', coalesce(v_m.state in ('finalized', 'locked'), false),
    'finalized_at', v_m.finalized_at,
    'locked', coalesce(v_m.state = 'locked', false),
    'locked_at', v_m.locked_at,
    'order', v_order,
    'num_rounds', v_l.num_rounds,
    'member_count', v_members,
    'min_members', 4,
    -- T−1h has passed but the league is below MIN_DRAFT_MEMBERS: the order is
    -- set the moment the 4th member joins (or at start), not before.
    'waiting_for_members', not v_started and coalesce(v_m.state, 'open') = 'open'
                           and public._draft_order_is_due(v_l.draft_date) and v_members < 4,
    'is_commissioner', v_comm,
    'can_edit_order', v_comm and v_l.draft_order_mode = 'manual' and v_open,
    'can_change_mode', v_comm and v_open,
    'server_now', now());
end;
$$;

-- set_draft_order — the commissioner saves a full manual order. Any number of
-- saves until draft_date − 1h. Game-flow refusals are jsonb reasons, not
-- exceptions (set_draft_queue pattern).
create or replace function public.set_draft_order(p_league_id uuid, p_user_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   text := auth.uid()::text;
  v_l     public.leagues%rowtype;
  v_state text;
  v_n     integer;
  v_order jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  select * into v_l from public.leagues where id = p_league_id for no key update;
  if not found or not exists (select 1 from public.league_members
                               where league_id = p_league_id and user_id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'not_a_member');
  end if;
  if v_l.commissioner_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'reason', 'not_commissioner');
  end if;
  if coalesce(v_l.draft_status, 'not_started') <> 'not_started' then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  if v_l.draft_order_mode <> 'manual' then
    return jsonb_build_object('ok', false, 'reason', 'not_manual');
  end if;

  perform public._draft_order_sync(p_league_id, false);   -- finalize if due; seed if absent
  select state into v_state from public.league_draft_order_meta where league_id = p_league_id;
  if v_state is distinct from 'open' then
    return jsonb_build_object('ok', false, 'reason', 'finalized');
  end if;

  select count(*) into v_n from public.league_members where league_id = p_league_id;
  if p_user_ids is null
     or array_ndims(p_user_ids) is distinct from 1
     or cardinality(p_user_ids) <> v_n
     or array_position(p_user_ids, null) is not null
     or (select count(distinct u) from unnest(p_user_ids) u) <> v_n
     or exists (select u from unnest(p_user_ids) u
                except
                select m.user_id from public.league_members m where m.league_id = p_league_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_a_permutation');
  end if;

  delete from public.league_draft_order where league_id = p_league_id;
  insert into public.league_draft_order (league_id, position, user_id)
  select p_league_id, t.ord, t.u from unnest(p_user_ids) with ordinality as t(u, ord);
  update public.league_draft_order_meta set last_edited_at = now() where league_id = p_league_id;

  select jsonb_agg(jsonb_build_object('position', o.position, 'user_id', o.user_id) order by o.position)
    into v_order
    from public.league_draft_order o where o.league_id = p_league_id;
  return jsonb_build_object('ok', true, 'order', v_order);
end;
$$;

-- ===========================================================================
-- 9. Service-only: the cron's work list and on-time finalize
-- ===========================================================================
-- Finalize every not-started league whose draft_date − 1h has passed and whose
-- order is not yet finalized. Called by draft-order-notify each tick so a
-- league nobody opened still finalizes (and gets its notice) on time.
create or replace function public.finalize_due_draft_orders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select l.id
      from public.leagues l
     where coalesce(l.draft_status, 'not_started') = 'not_started'
       and public._draft_order_is_due(l.draft_date)
       and (select count(*) from public.league_members x where x.league_id = l.id) >= 4
       and not exists (select 1 from public.league_draft_order_meta m
                        where m.league_id = l.id and m.state <> 'open')
     order by l.draft_date
     limit 100
  loop
    perform public._draft_order_sync(r.id, true);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Does draft-order-notify have anything to do? The cron posts only WHERE this
-- is true, so an idle system makes no edge calls.
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
                               where m.league_id = l.id and m.state <> 'open'))
      or exists (
           select 1 from public.league_notifications n
            where n.push_status = 'pending'
               or (n.push_status = 'sending' and n.push_attempted_at < now() - interval '10 minutes'));
$$;

-- ===========================================================================
-- 10. RLS + grants
-- ===========================================================================
alter table public.league_draft_order_meta enable row level security;
alter table public.league_draft_order      enable row level security;
alter table public.league_notifications    enable row level security;

-- Members may read the order and its state. Safe before the reveal: a random
-- order has NO rows until draft_date − 1h.
drop policy if exists league_draft_order_meta_select_member on public.league_draft_order_meta;
create policy league_draft_order_meta_select_member on public.league_draft_order_meta
  for select to authenticated using (public.is_member(league_id));
drop policy if exists league_draft_order_select_member on public.league_draft_order;
create policy league_draft_order_select_member on public.league_draft_order
  for select to authenticated using (public.is_member(league_id));
drop policy if exists league_notifications_select_own on public.league_notifications;
create policy league_notifications_select_own on public.league_notifications
  for select to authenticated using (user_id = auth.uid()::text);

-- Supabase grants ALL on new tables to anon/authenticated/service_role by
-- default. Revoke by name; grant back only what each role needs. Writes to the
-- order tables happen ONLY inside the definer functions above — not even the
-- service role (edge functions) can write them directly.
revoke all on table public.league_draft_order_meta from public, anon, authenticated, service_role;
revoke all on table public.league_draft_order      from public, anon, authenticated, service_role;
revoke all on table public.league_notifications    from public, anon, authenticated, service_role;
grant select on table public.league_draft_order_meta to authenticated, service_role;
grant select on table public.league_draft_order      to authenticated, service_role;
grant select on table public.league_notifications    to authenticated, service_role;
-- draft-order-notify records delivery state and nothing else.
grant update (push_status, push_attempts, push_attempted_at, push_error)
  on table public.league_notifications to service_role;

-- Client RPCs: authenticated only.
revoke all on function public.get_draft_order(uuid)         from public, anon, service_role;
revoke all on function public.set_draft_order(uuid, text[]) from public, anon, service_role;
grant execute on function public.get_draft_order(uuid)         to authenticated;
grant execute on function public.set_draft_order(uuid, text[]) to authenticated;

-- Cron / edge: service_role only.
revoke all on function public.finalize_due_draft_orders() from public, anon, authenticated;
revoke all on function public.draft_order_notify_due()    from public, anon, authenticated;
grant execute on function public.finalize_due_draft_orders() to service_role;
grant execute on function public.draft_order_notify_due()    to service_role;

-- Internals and trigger functions: no API role. Only the definer functions
-- (owner postgres) reach them. The randomizer is callable by nothing a client
-- or edge function holds.
revoke all on function public._draft_order_is_due(timestamptz)            from public, anon, authenticated, service_role;
revoke all on function public._draft_order_materialize(uuid, text)        from public, anon, authenticated, service_role;
revoke all on function public._draft_order_notify_members(uuid)           from public, anon, authenticated, service_role;
revoke all on function public._draft_order_finalize(uuid)                 from public, anon, authenticated, service_role;
revoke all on function public._draft_order_sync(uuid, boolean)            from public, anon, authenticated, service_role;
revoke all on function public._draft_order_matches_members(uuid)          from public, anon, authenticated, service_role;
revoke all on function public._draft_order_reconcile(uuid)                from public, anon, authenticated, service_role;
revoke all on function public.enforce_league_draft_order_rows()           from public, anon, authenticated, service_role;
revoke all on function public.enforce_league_draft_order_meta()           from public, anon, authenticated, service_role;
revoke all on function public.enforce_leagues_draft_order_mode()          from public, anon, authenticated, service_role;
revoke all on function public.lock_draft_order_on_start()                 from public, anon, authenticated, service_role;
revoke all on function public.sync_draft_order_on_member_change()         from public, anon, authenticated, service_role;

-- ===========================================================================
-- 11. One-off: leagues ALREADY past due at push time, finalized SILENTLY
-- ===========================================================================
-- A not-started league with >= 4 members whose draft_date − 1h has already
-- passed (abandoned test leagues, typically — the pre-check query in the
-- header lists them) is finalized here with NO notice. Otherwise the first
-- cron tick would finalize them through the normal path and push "the draft
-- order is set" about drafts nobody is going to run. Every finalize after
-- this migration notifies. Idempotent: a re-run finds nothing still open.
do $$
declare
  r record;
begin
  for r in
    select l.id, l.draft_order_mode
      from public.leagues l
     where coalesce(l.draft_status, 'not_started') = 'not_started'
       and public._draft_order_is_due(l.draft_date)
       and (select count(*) from public.league_members x where x.league_id = l.id) >= 4
       and not exists (select 1 from public.league_draft_order_meta m
                        where m.league_id = l.id and m.state <> 'open')
  loop
    perform public._draft_order_materialize(
      r.id, case when r.draft_order_mode = 'manual' then 'manual_seed' else 'random' end);
    update public.league_draft_order_meta
       set state = 'finalized', finalized_at = now()
     where league_id = r.id and state = 'open';
  end loop;
end;
$$;

-- ===========================================================================
-- Verify AFTER push (HUMAN ACTION) — never assume the revokes took:
--   SELECT proname, proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND (proname LIKE '%draft_order%' OR proname IN ('finalize_due_draft_orders','lock_draft_order_on_start'))
--    ORDER BY 1;
--   -- get_draft_order / set_draft_order: {postgres=X/postgres,authenticated=X/postgres}
--   -- finalize_due_draft_orders / draft_order_notify_due: {postgres=X/postgres,service_role=X/postgres}
--   -- every other function: {postgres=X/postgres}
--   SELECT relname, relacl FROM pg_class
--    WHERE relname IN ('league_draft_order','league_draft_order_meta','league_notifications');
--   -- no anon; authenticated=r; service_role=r (+ column UPDATE on league_notifications)
--   SELECT l.draft_status, l.draft_order_mode, m.state, count(o.*)
--     FROM leagues l LEFT JOIN league_draft_order_meta m ON m.league_id = l.id
--     LEFT JOIN league_draft_order o ON o.league_id = l.id
--    GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
--   -- every started league: legacy / locked with rows; not_started: random, no meta
-- Then run docs/security/draft-order-modes-effect-test.sql.
-- ===========================================================================
