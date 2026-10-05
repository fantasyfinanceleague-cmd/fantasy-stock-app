-- ============================================================================
-- Run it back (1/6): lineage columns on leagues + season-numbered finalize
-- ============================================================================
-- Design: docs/migrations/RUN_IT_BACK_DESIGN.md (rev 3.1), §2.3a and §2.8.
-- Architecture B: a renewed season is a NEW leagues row. previous_league_id
-- links it to the season it renews; lineage_id is the root league id shared by
-- every season of one group (NULL on a league that has never been renewed, so
-- its lineage key is its own id: coalesce(lineage_id, id)).
--
-- PROVISIONAL TIMESTAMP (Orchestrator, 2026-10-04): this file is named in the
-- 20261027000000-09 range and must be RE-STAMPED to a version later than prod's
-- latest applied migration right before release. It is a pure rename: nothing
-- here references its own filename.
--
-- finalize_league_draft: the season is now numbered from leagues.season_number
-- instead of a literal 1. season_number defaults to 1, so every existing league
-- behaves byte-identically. The function body is 20260926000000's, verbatim, with
-- exactly two expressions changed (marked below).
--
-- PRE-PUSH (read-only):
--   SELECT count(*) FROM leagues WHERE previous_league_id IS NOT NULL;   -- expect 0
-- POST-PUSH EFFECT CHECKS:
--   SELECT column_name, data_type, column_default FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='leagues'
--     AND column_name IN ('previous_league_id','lineage_id','season_number');
--   -- expect 3 rows; season_number NOT NULL default 1
-- ============================================================================

alter table public.leagues
  add column if not exists previous_league_id uuid
    references public.leagues(id) on delete restrict,
  add column if not exists lineage_id uuid,
  add column if not exists season_number int not null default 1;

alter table public.leagues
  drop constraint if exists leagues_season_number_positive;
alter table public.leagues
  add constraint leagues_season_number_positive check (season_number >= 1);

-- One successor per league: the race guard for two "Run it back" taps.
create unique index if not exists leagues_one_successor_uidx
  on public.leagues (previous_league_id) where previous_league_id is not null;
create index if not exists leagues_lineage_idx
  on public.leagues (lineage_id) where lineage_id is not null;

comment on column public.leagues.previous_league_id is
  'Run it back: the season this league renews (NULL = a first season). At most one successor per league (leagues_one_successor_uidx). A league that has a successor cannot be deleted (on delete restrict): the lineage must not lose a season silently.';
comment on column public.leagues.lineage_id is
  'Run it back: root league id of this group of seasons. NULL means the league is its own lineage root; use coalesce(lineage_id, id).';
comment on column public.leagues.season_number is
  'Run it back: 1-based season ordinal within the lineage. finalize_league_draft numbers the league''s season from it.';

-- ----------------------------------------------------------------------------
-- finalize_league_draft: 20260926000000 verbatim, two season-number changes
-- (the season INSERT and the select after it). CREATE OR REPLACE keeps the ACL,
-- so the grants below are re-stated to keep this file the lockdown it is.
-- ----------------------------------------------------------------------------
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
    values (p_league_id, v_league.season_number, coalesce(v_league.league_start_date, p_league_start))
    on conflict (league_id, season_number) do nothing;
    v_season_created := found;
    select id into v_season_id from league_seasons
    where league_id = p_league_id and season_number = v_league.season_number;
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

revoke all on function public.finalize_league_draft(uuid, text[], timestamptz, timestamptz, jsonb) from public;
revoke all on function public.finalize_league_draft(uuid, text[], timestamptz, timestamptz, jsonb) from anon;
revoke all on function public.finalize_league_draft(uuid, text[], timestamptz, timestamptz, jsonb) from authenticated;
grant execute on function public.finalize_league_draft(uuid, text[], timestamptz, timestamptz, jsonb) to service_role;
