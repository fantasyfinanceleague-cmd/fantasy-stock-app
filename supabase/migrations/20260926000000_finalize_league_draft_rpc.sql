-- ============================================================================
-- finalize_league_draft: server-side season schedule at draft completion
-- Closes STATUS §4 defect 1 (mobile-drafted leagues never get a season) and
-- lays the ground for F10 / RLS [I8],[I9] (policy drops are DEFERRED — see
-- supabase/migrations/deferred/README.md).
-- ============================================================================
-- PROBLEM
--   matchups, initial league_standings and leagues.league_start_date /
--   league_end_date were written ONLY by the web client (DraftPage completeDraft,
--   Leaderboard auto-generate). Web is paused and mobile never wrote them, while
--   validate-and-record-pick's markDraftComplete only flipped draft_status. Every
--   weekly job selects from matchups, so a mobile-drafted league was never
--   snapshotted or scored.
--   Separately: nothing has created a league_seasons row since the 2026-01-25
--   backfill (only start_new_league_season does, for season 2+), so
--   complete_league_season raises 'League has no active season' at the end of
--   EVERY league created after that date.
--
-- DESIGN
--   Pairings and dates are planned in TypeScript (supabase/functions/_shared/
--   schedule.ts, hermetic tests) by validate-and-record-pick and handed to this
--   function, which VALIDATES the payload and writes everything in ONE
--   transaction, including the draft_status flip. So a failure leaves the draft
--   'in_progress' (healable: the pick function re-finalizes on the next
--   pick/skip attempt) — never 'completed' with no schedule (unhealable: the pick
--   path refuses non-in_progress leagues).
--
--   Idempotency, per piece (never "any row exists => done" over the whole set):
--     * matchups:  keyed on (league_id, zero regular-season rows) under the league
--                  row lock. Existing count == payload count => already_present;
--                  any OTHER non-zero count => refused 'schedule_mismatch' (a
--                  partial or foreign schedule needs a human, not a silent pass).
--                  "zero regular-season rows" is also exactly the state
--                  start_new_league_season leaves, so season N works unchanged.
--     * standings: per participant — INSERT ... ON CONFLICT (league_id,user_id)
--                  DO NOTHING heals a partial web-era init.
--     * dates:     written from the payload when this call inserts the schedule
--                  (a fresh schedule defines the window); otherwise COALESCE.
--     * num_weeks: COALESCE(num_weeks, schedule length) — process-week-results
--                  reads num_weeks || 0, so NULL would start playoffs after wk 1.
--     * season:    season 1 created + linked only when current_season_id IS NULL.
--
-- SECURITY
--   SECURITY DEFINER, search_path pinned, EXECUTE for service_role ONLY. It trusts
--   no caller-supplied structure: every team id must be a league member, weeks
--   must be contiguous from 1, and every member must appear exactly once per week.
--
--   *** MUST NEVER BE GRANTED TO authenticated (or anon). *** Beyond the obvious
--   (a member could forge a schedule), PR #9's BEFORE UPDATE trigger
--   trg_leagues_member_update_columns allows a non-commissioner JWT to change
--   only draft_status + first-time dates on leagues; this function also writes
--   current_season_id and num_weeks, so under a member JWT the whole transaction
--   would abort with 42501. On the service-role path auth.uid() IS NULL and that
--   trigger is a no-op (compatible whether PR #9 lands before or after this).
--
--   Supabase grants EXECUTE on new functions to anon/authenticated explicitly via
--   ALTER DEFAULT PRIVILEGES; REVOKE FROM PUBLIC does NOT remove those. Hence the
--   explicit revokes below. Verify with the proacl query, never assume.
--
-- ---------------------------------------------------------------------------
-- PRE-PUSH (read-only; record the numbers):
--   -- leagues the season-1 backfill below will touch
--   SELECT count(*) FROM leagues
--   WHERE draft_status = 'completed' AND current_season_id IS NULL;
--
-- POST-PUSH EFFECT CHECKS (run each separately):
--   -- 1. grants: expect service_role (and postgres) ONLY — no anon=, no authenticated=, no =X/ (PUBLIC)
--   SELECT proname, proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname = 'finalize_league_draft';
--   -- 2. search_path pinned: expect {search_path=public, pg_temp}
--   SELECT proconfig FROM pg_proc WHERE proname = 'finalize_league_draft';
--   -- 3. backfill landed: expect 0
--   SELECT count(*) FROM leagues
--   WHERE draft_status = 'completed' AND current_season_id IS NULL;
--
-- STUCK-STATE DETECTOR (the new failure mode — also in docs/STATUS.md §7):
--   a draft with every pick made that is still 'in_progress' means finalize
--   failed and no member has retried. drafts.league_id is uuid; picks include
--   SKIP rows, which consume a turn.
--   SELECT l.id, l.name, l.league_type,
--          (SELECT count(*) FROM drafts d WHERE d.league_id = l.id)         AS picks,
--          (SELECT count(*) FROM league_members m WHERE m.league_id = l.id) AS members,
--          l.num_rounds
--   FROM leagues l
--   WHERE l.draft_status = 'in_progress'
--     AND (SELECT count(*) FROM drafts d WHERE d.league_id = l.id) > 0   -- 0 >= 0*rounds is not "stuck"
--     AND (SELECT count(*) FROM drafts d WHERE d.league_id = l.id)
--         >= (SELECT count(*) FROM league_members m WHERE m.league_id = l.id) * l.num_rounds;
-- ============================================================================

create or replace function public.finalize_league_draft(
  p_league_id    uuid,
  p_member_ids   text[],        -- canonical order (computeDraftOrder)
  p_league_start timestamptz,
  p_league_end   timestamptz,
  p_matchups     jsonb          -- [{week_number, team1_user_id, team2_user_id, week_start, week_end}]; [] for duration
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_league            leagues%rowtype;
  v_n_members         int;
  v_n_rows            int;
  v_max_week          int;
  v_existing          int;
  v_matchups_inserted int := 0;
  v_standings_added   int := 0;
  v_season_created    boolean := false;
  v_season_id         uuid;
  v_status_flipped    boolean := false;
  v_schedule_fresh    boolean := false;
  v_ok                boolean;
begin
  -- 1. Serialize concurrent finalizers (last pick racing a heal retry).
  select * into v_league from leagues where id = p_league_id for update;
  if not found then
    return jsonb_build_object('status', 'refused', 'reason', 'league_not_found');
  end if;
  if v_league.draft_status not in ('in_progress', 'completed') then
    return jsonb_build_object('status', 'refused', 'reason', 'draft_not_started');
  end if;

  -- 2. Roster: p_member_ids must be exactly the league's member SET (no dups, no
  --    nulls). Explicit ::text on both sides — league_members.user_id is text, but
  --    this codebase mixes text/uuid user ids across tables (drafts vs trades).
  if p_member_ids is null or cardinality(p_member_ids) = 0
     or array_position(p_member_ids, null) is not null
     or (select count(distinct x) from unnest(p_member_ids) x) <> cardinality(p_member_ids) then
    return jsonb_build_object('status', 'refused', 'reason', 'invalid_payload', 'detail', 'member_ids');
  end if;
  v_n_members := cardinality(p_member_ids);

  if exists (
    (select m.user_id::text from league_members m where m.league_id = p_league_id
     except select x::text from unnest(p_member_ids) x)
    union all
    (select x::text from unnest(p_member_ids) x
     except select m.user_id::text from league_members m where m.league_id = p_league_id)
  ) then
    return jsonb_build_object('status', 'refused', 'reason', 'roster_mismatch');
  end if;

  -- 3. Window.
  if p_league_start is null or p_league_end is null or p_league_start >= p_league_end then
    return jsonb_build_object('status', 'refused', 'reason', 'invalid_payload', 'detail', 'league_window');
  end if;

  -- 4. Matchup payload (defense in depth: service_role is trusted, but a second
  --    caller must not be able to write a malformed schedule through this).
  if p_matchups is null or jsonb_typeof(p_matchups) <> 'array' then
    return jsonb_build_object('status', 'refused', 'reason', 'invalid_payload', 'detail', 'matchups_not_array');
  end if;
  v_n_rows := jsonb_array_length(p_matchups);

  if v_league.league_type = 'duration' then
    if v_n_rows <> 0 then
      return jsonb_build_object('status', 'refused', 'reason', 'invalid_payload', 'detail', 'duration_has_matchups');
    end if;
  elsif v_league.league_type = 'matchup' then
    if v_n_rows = 0 or v_n_members < 2 then
      return jsonb_build_object('status', 'refused', 'reason', 'invalid_payload', 'detail', 'empty_schedule');
    end if;

    -- Field types: a non-integer week or unparseable timestamp raises a class-22
    -- data_exception inside jsonb_to_recordset; turn that into a clean refusal.
    begin
      select
        bool_and(r.week_number >= 1
                 and r.team1_user_id is not null
                 and r.team1_user_id = any (p_member_ids)
                 and (r.team2_user_id is null
                      or (r.team2_user_id = any (p_member_ids) and r.team2_user_id <> r.team1_user_id))
                 and r.week_start is not null and r.week_end is not null
                 and r.week_start < r.week_end),
        max(r.week_number)
      into v_ok, v_max_week
      from jsonb_to_recordset(p_matchups) as r(
        week_number int, team1_user_id text, team2_user_id text,
        week_start timestamptz, week_end timestamptz);
    exception when data_exception then
      return jsonb_build_object('status', 'refused', 'reason', 'invalid_payload', 'detail', 'field_types');
    end;
    if not coalesce(v_ok, false) then
      return jsonb_build_object('status', 'refused', 'reason', 'invalid_payload', 'detail', 'row_fields');
    end if;

    -- Weeks contiguous from 1, and every member exactly once in every week
    -- (a completeness check, not just "no duplicates": a truncated payload fails).
    if exists (
      with r as (
        select * from jsonb_to_recordset(p_matchups) as r(
          week_number int, team1_user_id text, team2_user_id text)
      ), appearances as (
        select week_number, team1_user_id as uid from r
        union all
        select week_number, team2_user_id from r where team2_user_id is not null
      ), grid as (
        select w, u from generate_series(1, v_max_week) w, unnest(p_member_ids) u
      )
      select 1 from grid g
      left join appearances a on a.week_number = g.w and a.uid = g.u
      group by g.w, g.u
      having count(a.uid) <> 1
    ) then
      return jsonb_build_object('status', 'refused', 'reason', 'invalid_payload', 'detail', 'week_coverage');
    end if;

    if v_league.num_weeks is not null and v_league.num_weeks <> v_max_week then
      return jsonb_build_object('status', 'refused', 'reason', 'invalid_payload', 'detail', 'num_weeks_mismatch');
    end if;

    -- 5. Existing schedule: compare a COUNT against the expected set.
    select count(*) into v_existing
    from matchups where league_id = p_league_id and coalesce(is_playoff, false) = false;
    if v_existing <> 0 and v_existing <> v_n_rows then
      return jsonb_build_object('status', 'refused', 'reason', 'schedule_mismatch',
                                'existing', v_existing, 'expected', v_n_rows);
    end if;
    v_schedule_fresh := (v_existing = 0);
  else
    return jsonb_build_object('status', 'refused', 'reason', 'unknown_league_type');
  end if;

  -- ---- All validation passed; writes below. -------------------------------

  if v_schedule_fresh then
    insert into matchups (league_id, week_number, team1_user_id, team2_user_id, week_start, week_end, is_playoff)
    select p_league_id, r.week_number, r.team1_user_id, r.team2_user_id, r.week_start, r.week_end, false
    from jsonb_to_recordset(p_matchups) as r(
      week_number int, team1_user_id text, team2_user_id text,
      week_start timestamptz, week_end timestamptz);
    get diagnostics v_matchups_inserted = row_count;
  end if;

  if v_league.league_type = 'matchup' then
    insert into league_standings (league_id, user_id)
    select p_league_id, x::text from unnest(p_member_ids) x
    on conflict (league_id, user_id) do nothing;
    get diagnostics v_standings_added = row_count;
  end if;

  -- Season 1 (only when the league has no current season).
  if v_league.current_season_id is null then
    insert into league_seasons (league_id, season_number, started_at)
    values (p_league_id, 1, coalesce(v_league.league_start_date, p_league_start))
    on conflict (league_id, season_number) do nothing;
    v_season_created := found;
    select id into v_season_id from league_seasons
    where league_id = p_league_id and season_number = 1;
  end if;

  update leagues set
    league_start_date = case when v_schedule_fresh then p_league_start
                             else coalesce(league_start_date, p_league_start) end,
    league_end_date   = case when v_schedule_fresh then p_league_end
                             else coalesce(league_end_date, p_league_end) end,
    num_weeks         = case when league_type = 'matchup' then coalesce(num_weeks, v_max_week)
                             else num_weeks end,
    current_season_id = coalesce(current_season_id, v_season_id),
    draft_status      = 'completed'
  where id = p_league_id;

  v_status_flipped := (v_league.draft_status = 'in_progress');

  return jsonb_build_object(
    'status', case when v_status_flipped or v_matchups_inserted > 0 or v_standings_added > 0
                        or v_season_created then 'finalized' else 'already_finalized' end,
    'matchups_inserted', v_matchups_inserted,
    'standings_inserted', v_standings_added,
    'season_created', v_season_created);
end;
$$;

-- Grants: close PUBLIC *and* Supabase's explicit default grants. See header.
revoke all on function public.finalize_league_draft(uuid, text[], timestamptz, timestamptz, jsonb) from public;
revoke all on function public.finalize_league_draft(uuid, text[], timestamptz, timestamptz, jsonb) from anon;
revoke all on function public.finalize_league_draft(uuid, text[], timestamptz, timestamptz, jsonb) from authenticated;
grant execute on function public.finalize_league_draft(uuid, text[], timestamptz, timestamptz, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- One-time, idempotent season-1 backfill for leagues that completed a draft after
-- the 2026-01-25 backfill and so have no season (mirrors 20260125000000). Runs as
-- the migration owner: auth.uid() IS NULL, so PR #9's leagues trigger is a no-op.
-- ---------------------------------------------------------------------------
insert into league_seasons (league_id, season_number, started_at)
select l.id, 1, coalesce(l.league_start_date, l.draft_date, l.created_at)
from leagues l
where l.draft_status = 'completed' and l.current_season_id is null
on conflict (league_id, season_number) do nothing;

update leagues l
set current_season_id = ls.id
from league_seasons ls
where ls.league_id = l.id
  and ls.season_number = 1
  and l.draft_status = 'completed'
  and l.current_season_id is null;
