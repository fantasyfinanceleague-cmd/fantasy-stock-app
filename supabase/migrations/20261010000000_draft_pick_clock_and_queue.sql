-- Draft pick clock + server auto-pick + draft queue (feat/draft-pick-clock-autopick).
--
-- PRODUCT RULES (Giorgio, 2026-09-29): every turn has a clock — 60s by
-- default, commissioner-configurable to 30/45/60/75/90s at creation and until
-- the draft starts. When it runs out the SERVER picks: first the manager's own
-- queue (in order, first still-legal symbol), then best available. Never
-- random. A skip only when nothing at all is legal.
--
-- WHAT THIS FILE ADDS
--   leagues.pick_seconds        smallint, 30..90 in 15s steps, default 60.
--                               Locked once the draft leaves 'not_started'.
--   leagues.pick_clock_enabled  EXPLICIT discriminator for "does the sweep
--                               auto-pick this draft". Every new league, and
--                               every draft START, gets true; only the drafts
--                               ALREADY in_progress at push time are set false
--                               here (see PRE-EXISTING DRAFTS), and only until
--                               that draft ends. Clients can never change it.
--   leagues.draft_started_at    Written ONLY by trg_leagues_pick_clock: stamped
--                               on the transition into 'in_progress' (via
--                               draft-control, the commissioner's direct [I2a]
--                               flip, or a re-draft). Any direct write is
--                               discarded, whatever the caller's role.
--   drafts.recorded_at          timestamptz DEFAULT now(). Added rather than
--                               reusing drafts.created_at, whose type/default
--                               was created out-of-band and is not in the repo;
--                               the clock must not depend on a column whose
--                               time-zone semantics nobody has verified.
--   drafts.pick_source          EXPLICIT discriminator for how a pick was made:
--                               manual | bot | skip | auto_queue | auto_best |
--                               auto_skip. The UI's "Auto-picked" label is
--                               pick_source LIKE 'auto_%'. Nothing is inferred
--                               from symbol='SKIP' or a NULL (CLAUDE.md
--                               "Overloaded NULLs are type tags").
--   draft_queue                 per (league, user) ordered list, owner-only
--                               SELECT, writes only via set_draft_queue.
--   get_draft_clock(league)     THE one definition of the turn deadline.
--   overdue_draft_turns()       the sweep's work list (service_role only).
--   set_draft_queue(league, [])  replace-the-whole-list write path.
--
-- THE DEADLINE IS DERIVED, NOT STORED
--   turn_started_at = GREATEST(draft_started_at, max(drafts.recorded_at))
--   deadline_at     = turn_started_at + pick_seconds
-- drafts rows are writable only by the service role (20260811000003 dropped
-- every client INSERT policy; there is no UPDATE policy), so the anchor cannot
-- be forged, and it cannot drift from the pick it belongs to — the anchor IS
-- the previous pick's own row. A stored "current_pick_started_at" on leagues
-- would be commissioner-editable through [I2a] and could disagree with the
-- drafts table (the partial-state family, CLAUDE.md). Chained timeouts fall
-- out for free: an auto-pick recorded at T starts the next turn's full clock
-- at T, so absent managers are picked one full clock apart, never in a burst.
--
-- NO TURN MATH IN SQL. Whose turn it is stays in _shared/draft-validation.ts
-- (computeDraftOrder sorts member ids with JS code-unit order; Postgres text
-- ORDER BY uses the database collation, which can order the same ids
-- differently). SQL only answers "is the current turn overdue", which needs a
-- count and a timestamp, not an order.
--
-- PRE-EXISTING DRAFTS (Orchestrator decision, pending Giorgio's Q2): a league
-- already 'in_progress' when this is pushed gets pick_clock_enabled = false
-- and draft_started_at NULL, so the sweep never touches it — an automated job
-- must not finalize old test leagues and create seasons in prod as a side
-- effect of this migration. Giorgio's choice is a separate, explicit step
-- (docs/migrations/DRAFT_PICK_CLOCK.md): opt a league in with
--   UPDATE public.leagues SET pick_clock_enabled = true WHERE id = '<id>';
-- (run as postgres/service role; the trigger then starts a FRESH clock at that
-- moment), or abandon it by hand.
--
-- GRANTS (CLAUDE.md "Postgres function grants"): REVOKE ... FROM PUBLIC does
-- not clear Supabase's explicit anon/authenticated default grants, so each
-- function below revokes from anon (and authenticated where it is
-- service-only) by name. Verify with the proacl query at the bottom — never
-- assume.
--
-- HUMAN ACTION: supabase db push, from the deploy checkout only (CLAUDE.md).
-- Push BEFORE deploying validate-and-record-pick / draft-autopick-sweep: the
-- new code writes drafts.pick_source and calls get_draft_clock. Old deployed
-- code keeps working against this schema (pick_source defaults to 'manual';
-- nothing it writes is refused), so the push is safe on its own.

-- ===========================================================================
-- 1. leagues: pick_seconds, pick_clock_enabled, draft_started_at
-- ===========================================================================
alter table public.leagues
  add column if not exists pick_seconds smallint not null default 60,
  add column if not exists pick_clock_enabled boolean not null default true,
  add column if not exists draft_started_at timestamptz;

alter table public.leagues drop constraint if exists leagues_pick_seconds_check;
alter table public.leagues add constraint leagues_pick_seconds_check
  check (pick_seconds between 30 and 90 and pick_seconds % 15 = 0);

-- Pre-existing drafts: NOT clocked (see header). Runs before the trigger
-- below exists; the member column-guard trigger is a no-op here (auth.uid()
-- is NULL in a migration).
update public.leagues
   set pick_clock_enabled = false
 where draft_status = 'in_progress';

-- A clocked, running draft always has its anchor. (A pre-existing draft is
-- unclocked, so its NULL draft_started_at is not a tag anything reads: every
-- reader tests pick_clock_enabled first.)
alter table public.leagues drop constraint if exists leagues_pick_clock_started_check;
alter table public.leagues add constraint leagues_pick_clock_started_check
  check (not pick_clock_enabled or draft_status is distinct from 'in_progress' or draft_started_at is not null);

comment on column public.leagues.pick_seconds is
  'Seconds per draft turn: 30/45/60/75/90 (default 60). Set at creation, editable by the commissioner while draft_status = ''not_started''; trg_leagues_pick_clock refuses any change after that.';
comment on column public.leagues.pick_clock_enabled is
  'Explicit discriminator: true = the draft-autopick sweep auto-picks overdue turns in this league. New leagues always true. Drafts already in_progress when 20261010000000 was pushed were set false (never auto-picked) until an operator opts them in. Clients cannot change it.';
comment on column public.leagues.draft_started_at is
  'When the draft entered in_progress (the first turn''s clock anchor). Written only by trg_leagues_pick_clock; direct writes are discarded.';

create or replace function public.enforce_leagues_pick_clock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    -- A client-created league is always clocked; only a server-side caller
    -- (service role / SQL editor: auth.uid() NULL) may create one unclocked.
    if auth.uid() is not null then
      new.pick_clock_enabled := true;
    end if;
    new.draft_started_at := case when new.draft_status = 'in_progress' then now() else null end;
    return new;
  end if;

  -- UPDATE --------------------------------------------------------------
  if auth.uid() is not null then
    new.pick_clock_enabled := old.pick_clock_enabled;   -- clients can't opt out of the clock
  end if;

  if new.pick_seconds is distinct from old.pick_seconds
     and coalesce(old.draft_status, 'not_started') <> 'not_started' then
    raise exception 'pick_seconds_locked: the pick clock can only be changed before the draft starts'
      using errcode = '22023';
  end if;

  if new.draft_status = 'in_progress' and old.draft_status is distinct from 'in_progress' then
    -- Every draft START is clocked, whoever starts it. The push-time hold
    -- (pick_clock_enabled=false) covers only the draft that was ALREADY
    -- running; a held league's next draft (a new season, a re-draft) must
    -- not inherit it, or the hold would silently become permanent.
    new.pick_clock_enabled := true;
    new.draft_started_at := now();                      -- draft (re)starts: first turn's clock
  elsif new.draft_status = 'in_progress' and new.pick_clock_enabled and not old.pick_clock_enabled then
    new.draft_started_at := now();                      -- operator opt-in of a pre-existing draft: fresh clock
  else
    new.draft_started_at := old.draft_started_at;       -- nobody writes it directly
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_leagues_pick_clock() from public;
revoke all on function public.enforce_leagues_pick_clock() from anon, authenticated;

-- Name sorts AFTER trg_leagues_member_update_columns ('m' < 'p'), so the
-- member column-guard sees the caller's row before this trigger touches it.
drop trigger if exists trg_leagues_pick_clock on public.leagues;
create trigger trg_leagues_pick_clock
  before insert or update on public.leagues
  for each row
  execute function public.enforce_leagues_pick_clock();

-- ===========================================================================
-- 2. drafts: recorded_at + pick_source
-- ===========================================================================
-- now() is STABLE, so existing rows all get this migration's timestamp without
-- a table rewrite. Only matters for pre-existing drafts, which are unclocked.
alter table public.drafts
  add column if not exists recorded_at timestamptz not null default now(),
  add column if not exists pick_source text not null default 'manual';

-- Backfill the discriminator for history. Web-era explicit bot picks become
-- 'bot' too — they were never a human's choice.
update public.drafts
   set pick_source = case
     when upper(symbol) = 'SKIP' then 'skip'
     when user_id like 'bot-%' then 'bot'
     else 'manual'
   end
 where pick_source = 'manual';

alter table public.drafts drop constraint if exists drafts_pick_source_check;
alter table public.drafts add constraint drafts_pick_source_check
  check (pick_source in ('manual', 'bot', 'skip', 'auto_queue', 'auto_best', 'auto_skip'));

create index if not exists drafts_league_recorded_at_idx
  on public.drafts (league_id, recorded_at desc);

comment on column public.drafts.recorded_at is
  'When the pick row was written (DEFAULT now()); the NEXT turn''s clock anchor. Never set by callers.';
comment on column public.drafts.pick_source is
  'How the pick was made: manual (the picker chose it), bot (server choice for a bot), skip (voluntary / bot fallback), auto_queue / auto_best (clock expired: from the manager''s queue / best available), auto_skip (clock expired, nothing legal). UI "Auto-picked" = LIKE ''auto_%''.';

-- ===========================================================================
-- 3. draft_queue
-- ===========================================================================
-- user_id is TEXT to match league_members.user_id and drafts.user_id, so the
-- joins need no casts (CLAUDE.md cross-table cast footgun). Bots never queue.
create table if not exists public.draft_queue (
  league_id  uuid        not null references public.leagues(id) on delete cascade,
  user_id    text        not null check (user_id !~ '^bot-'),
  symbol     text        not null check (symbol = upper(symbol) and length(symbol) between 1 and 12),
  position   smallint    not null check (position between 1 and 50),
  updated_at timestamptz not null default now(),
  primary key (league_id, user_id, symbol),
  unique (league_id, user_id, position)
);

comment on table public.draft_queue is
  'A manager''s ordered draft queue: what the server auto-picks from when their clock expires. Owner-only SELECT; writes only via set_draft_queue. Other managers never see it; the auto-pick reads it as service role.';

alter table public.draft_queue enable row level security;

drop policy if exists draft_queue_select_own on public.draft_queue;
create policy draft_queue_select_own on public.draft_queue
  for select to authenticated
  using (user_id = auth.uid()::text);

-- Supabase grants ALL on new tables to anon/authenticated by default; RLS
-- would already refuse writes (no write policies), this removes the grants
-- too so a future permissive policy can't silently open them.
revoke all on table public.draft_queue from anon;
revoke insert, update, delete, truncate, references, trigger on table public.draft_queue from authenticated;
grant select on table public.draft_queue to authenticated;

-- ===========================================================================
-- 4. get_draft_clock — THE deadline definition
-- ===========================================================================
-- SECURITY INVOKER: a member reads it through the existing leagues/drafts
-- SELECT policies; a non-member gets zero rows. The service role (edge
-- functions) bypasses RLS and reads the same definition. server_now is the
-- DB clock — the edge gate authorizes on it, never on a client's clock.
create or replace function public.get_draft_clock(p_league_id uuid)
returns table (
  league_id       uuid,
  draft_status    text,
  clock_running   boolean,
  pick_seconds    integer,
  picks_made      integer,
  turn_started_at timestamptz,
  deadline_at     timestamptz,
  server_now      timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select l.id,
         l.draft_status,
         c.running,
         l.pick_seconds::integer,
         d.n,
         case when c.running then greatest(l.draft_started_at, d.last_at) end,
         case when c.running then greatest(l.draft_started_at, d.last_at) + make_interval(secs => l.pick_seconds) end,
         now()
    from public.leagues l
   cross join lateral (
     select count(*)::integer as n, max(x.recorded_at) as last_at
       from public.drafts x
      where x.league_id = l.id
   ) d
   cross join lateral (
     select (l.pick_clock_enabled and l.draft_status = 'in_progress') as running
   ) c
   where l.id = p_league_id;
$$;

revoke all on function public.get_draft_clock(uuid) from public;
revoke all on function public.get_draft_clock(uuid) from anon;
grant execute on function public.get_draft_clock(uuid) to authenticated, service_role;

-- ===========================================================================
-- 5. overdue_draft_turns — the sweep's work list
-- ===========================================================================
-- Every clocked in_progress league whose current turn is past its deadline.
-- Includes a draft whose picks are all made but whose finalize failed: the
-- sweep then re-runs the idempotent finalize, so a transient finalize failure
-- heals without anyone opening the app. Lists every live draft, so it is
-- service_role (and the cron's postgres owner) only.
create or replace function public.overdue_draft_turns()
returns table (league_id uuid, pick_number integer, deadline_at timestamptz)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select c.league_id, c.picks_made + 1, c.deadline_at
    from public.leagues l
   cross join lateral public.get_draft_clock(l.id) c
   where l.draft_status = 'in_progress'
     and l.pick_clock_enabled
     and c.clock_running
     and c.deadline_at <= now()
   order by c.deadline_at;
$$;

revoke all on function public.overdue_draft_turns() from public;
revoke all on function public.overdue_draft_turns() from anon, authenticated;
grant execute on function public.overdue_draft_turns() to service_role;

-- ===========================================================================
-- 6. set_draft_queue — replace the caller's whole queue
-- ===========================================================================
-- Add / remove / reorder are all "send the new list". Uppercases, trims, and
-- de-duplicates keeping the first occurrence; refuses more than 50. Symbols
-- must exist in public.symbols — that refusal lists the unknown ones, which
-- reveals nothing new: symbols is readable by everyone (policy "read",
-- USING (true)). Draftability/ownership are NOT checked here — they change
-- during the draft, and the auto-pick re-checks every queued symbol through
-- the same legality gate a manual pick uses.
--
-- Concurrent calls by the same manager (two devices) serialize on their
-- league_members row lock, so the delete+insert pair never interleaves.
create or replace function public.set_draft_queue(p_league_id uuid, p_symbols text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     text := auth.uid()::text;
  v_status  text;
  v_syms    text[];
  v_unknown text[];
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  perform 1 from public.league_members m
   where m.league_id = p_league_id and m.user_id = v_uid
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_a_member');
  end if;

  select l.draft_status into v_status from public.leagues l where l.id = p_league_id;
  if v_status = 'completed' then
    return jsonb_build_object('ok', false, 'reason', 'draft_completed');
  end if;

  -- Bound the raw input before doing any work on it.
  if coalesce(cardinality(p_symbols), 0) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'too_many', 'max', 50);
  end if;

  select coalesce(array_agg(t.s order by t.first_ord), '{}')
    into v_syms
    from (
      select upper(btrim(u.x)) as s, min(u.ord) as first_ord
        from unnest(coalesce(p_symbols, '{}'::text[])) with ordinality as u(x, ord)
       where btrim(coalesce(u.x, '')) <> ''
       group by 1
    ) t;

  if cardinality(v_syms) > 50 then
    return jsonb_build_object('ok', false, 'reason', 'too_many', 'max', 50);
  end if;

  select array_agg(s) into v_unknown
    from unnest(v_syms) as s
   where not exists (select 1 from public.symbols y where y.symbol = s);
  if v_unknown is not null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_symbols', 'symbols', to_jsonb(v_unknown));
  end if;

  delete from public.draft_queue q where q.league_id = p_league_id and q.user_id = v_uid;
  insert into public.draft_queue (league_id, user_id, symbol, position)
  select p_league_id, v_uid, s, ord::smallint
    from unnest(v_syms) with ordinality as u(s, ord);

  return jsonb_build_object('ok', true, 'symbols', to_jsonb(v_syms));
end;
$$;

revoke all on function public.set_draft_queue(uuid, text[]) from public;
revoke all on function public.set_draft_queue(uuid, text[]) from anon;
grant execute on function public.set_draft_queue(uuid, text[]) to authenticated;

-- ===========================================================================
-- Effect-verify AFTER push (HUMAN ACTION; CLAUDE.md: never trust the push):
--   SELECT proname, proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND proname IN ('get_draft_clock','overdue_draft_turns','set_draft_queue','enforce_leagues_pick_clock');
--   -- get_draft_clock: authenticated + service_role, no anon, no bare "=X"
--   -- overdue_draft_turns: service_role only
--   -- set_draft_queue: authenticated only (no anon, no bare "=X")
--   SELECT id, name, pick_clock_enabled, draft_started_at FROM leagues WHERE draft_status = 'in_progress';
--   -- every row pick_clock_enabled = false (pre-existing), until Giorgio opts one in
--   SELECT pick_source, count(*) FROM drafts GROUP BY 1;
-- Then run docs/security/draft-pick-clock-effect-test.sql (rolled back).
