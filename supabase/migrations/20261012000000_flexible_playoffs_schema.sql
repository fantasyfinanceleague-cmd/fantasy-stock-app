-- ============================================================================
-- Flexible playoffs (1/4): bracket addresses on matchups; playoff_teams rules
-- ============================================================================
-- PRODUCT RULE (Giorgio, 2026-09-29): the commissioner picks any playoff team
-- count P from 2 to the number of managers. Weeks W = ceil(log2 P); the top
-- 2^W - P seeds get a first-round bye; the bracket is FIXED (no re-seeding).
-- The pure math is supabase/functions/_shared/playoff-bracket.ts.
--
-- WHAT THIS MIGRATION DOES
--   1. matchups.playoff_round_number (1..W) + matchups.bracket_position
--      (0..2^(W-r)-1): every playoff game gets an ADDRESS. The winner of
--      (r, p) always plays in (r+1, floor(p/2)), slot team1 if p is even,
--      team2 if odd. Before this, advancePlayoffWinner put a winner into the
--      FIRST EMPTY SLOT of any next-round row in unordered query order, so even
--      the 8-team bracket was not actually fixed (1v8's winner could meet
--      2v7's), and with byes it would be wrong outright.
--      CHECK: a playoff row has both columns, a regular row has neither.
--   2. BYES ARE NOT ROWS. A bye seed is written straight into its round-2 slot
--      when the bracket is created. A scoreless "bye row" would sit in a table
--      where team1_gain IS NULL means "pending" to the pending-matchup query,
--      the week-advance check, and the unscored audit (CLAUDE.md: guards blind
--      to partial state). With addresses, a round-2 slot's provenance is
--      structural: it is a bye iff no round-1 game exists at 2p+slot, and
--      start_league_playoffs validates the exact shape, so that absence is
--      guaranteed, never inferred. In a playoff row a NULL team keeps ONE
--      meaning: "awaiting the feeder game's winner".
--   3. playoff_round gains 'round_of_16' (a 4-round bracket's first round).
--      It stays a STRUCTURAL code by distance from the final ('finals','semi',
--      'quarter','round_of_16'), read by installed app builds and the
--      season-completion check. Display labels ("Wild card", ...) are computed
--      by the client helpers from playoff_teams, never stored.
--   4. Replaces the 20261011000004 backstop index with a strictly stronger one:
--      UNIQUE (league_id, playoff_round_number, bracket_position) WHERE
--      is_playoff. The old (league, round, week, team1_seed) key could not see a
--      second bracket made only of NULL-seed placeholders (its own header says
--      so); this key rejects ANY second row at an occupied address.
--   5. playoff_teams: backfill NULL -> 4 on matchup leagues (NULL has always
--      been read as 4 downstream via `playoff_teams || 4`), then REQUIRE it on
--      matchup leagues and relax the old IN (2,4,8) to >= 2. "P <= managers"
--      spans two tables, so it is enforced where membership freezes: the
--      draft-control start check. No upper-bound CHECK here.
--
-- LEGACY PLAYOFF ROWS (brackets built before this, all 2/4/8 teams, no byes)
--   round number = dense rank of week_number among the league's playoff rows.
--   position     = order of the row's best seed in the display seed order
--                  (1,8 | 5,4 | 3,6 | 7,2 for 8 lines), divided down to that
--                  round; rows without seeds (unfilled placeholders) take the
--                  remaining positions. For a correctly built legacy round 1
--                  this reproduces the exact addresses the new code uses, so an
--                  in-flight 4-team bracket keeps advancing correctly.
--   A DO block asserts the result: every playoff row addressed, all addresses
--   unique. Anything else raises and the whole migration rolls back.
--
-- ---------------------------------------------------------------------------
-- PRE-CHECKS (read-only; run BEFORE db push and paste the output):
--   -- a. matchup leagues that the backfill will set to 4, and any P > members
--   SELECT l.id, l.name, l.league_type, l.playoff_teams, l.num_participants,
--          l.draft_status, l.season_status,
--          (SELECT count(*) FROM league_members m WHERE m.league_id = l.id) AS members
--   FROM leagues l
--   WHERE (l.league_type = 'matchup' AND l.playoff_teams IS NULL)
--      OR l.playoff_teams > (SELECT count(*) FROM league_members m WHERE m.league_id = l.id)
--      OR l.season_status = 'playoffs';
--   -- b. legacy playoff rows to address, per league
--   SELECT league_id, count(*) AS rows, count(DISTINCT week_number) AS rounds,
--          count(*) FILTER (WHERE team1_user_id IS NULL OR team2_user_id IS NULL) AS unfilled
--   FROM matchups WHERE is_playoff GROUP BY league_id;
--
-- POST-PUSH EFFECT CHECKS:
--   SELECT count(*) FROM matchups WHERE is_playoff
--     AND (playoff_round_number IS NULL OR bracket_position IS NULL);          -- expect 0
--   SELECT indexname FROM pg_indexes
--     WHERE indexname IN ('matchups_bracket_address', 'matchups_one_bracket_per_league'); -- expect only the first
--   SELECT count(*) FROM leagues WHERE league_type = 'matchup' AND playoff_teams IS NULL; -- expect 0
--   SELECT conname, convalidated FROM pg_constraint
--     WHERE conname IN ('valid_playoff_teams', 'leagues_matchup_requires_playoff_teams',
--                       'matchups_playoff_address', 'valid_playoff_round');         -- all t
--
-- DEPLOY ORDER: push this BEFORE deploying validate-and-record-pick,
-- draft-autopick-sweep, draft-control or process-week-results with the flexible
-- playoffs code. planSeason and the start check now REFUSE a NULL playoff_teams
-- on a matchup league instead of reading it as 4.
-- ============================================================================

-- 1. Addresses ---------------------------------------------------------------
alter table public.matchups
  add column if not exists playoff_round_number smallint,
  add column if not exists bracket_position smallint;

-- 3. Round code --------------------------------------------------------------
alter table public.matchups drop constraint if exists valid_playoff_round;
alter table public.matchups add constraint valid_playoff_round
  check (playoff_round is null or playoff_round in ('round_of_16', 'quarter', 'semi', 'finals'));

-- Legacy backfill (see header) ------------------------------------------------
do $$
declare
  v_league   uuid;
  v_rounds   int;
  v_size     int;
  v_order    int[];
  v_next     int[];
  v_n2       int;
  v_i        int;
  v_s        int;
  v_bad      int;
begin
  for v_league in select distinct league_id from public.matchups where is_playoff loop
    update public.matchups m
       set playoff_round_number = x.rn
      from (select id, dense_rank() over (order by week_number) as rn
              from public.matchups where league_id = v_league and is_playoff) x
     where m.id = x.id;

    select max(playoff_round_number) into v_rounds from public.matchups
     where league_id = v_league and is_playoff;
    v_size := 1 << v_rounds;

    -- Display seed order for v_size lines (same recursion as seedOrder()).
    v_order := array[1, 2];
    while array_length(v_order, 1) < v_size loop
      v_n2 := array_length(v_order, 1) * 2;
      v_next := '{}';
      for v_i in 1 .. array_length(v_order, 1) loop
        v_s := v_order[v_i];
        if (v_i - 1) % 2 = 0 then v_next := v_next || array[v_s, v_n2 + 1 - v_s];
        else v_next := v_next || array[v_n2 + 1 - v_s, v_s];
        end if;
      end loop;
      v_order := v_next;
    end loop;

    -- Position within the round: by the best seed's line, divided down to the
    -- round (line / 2^round); seedless placeholders fill what is left.
    update public.matchups m
       set bracket_position = x.pos
      from (select id,
                   (row_number() over (
                      partition by playoff_round_number
                      order by (array_position(v_order, least(team1_seed, team2_seed)) - 1)
                               / (1 << playoff_round_number) nulls last,
                               id) - 1) as pos
              from public.matchups where league_id = v_league and is_playoff) x
     where m.id = x.id;
  end loop;

  select count(*) into v_bad from public.matchups
   where is_playoff and (playoff_round_number is null or bracket_position is null);
  if v_bad > 0 then
    raise exception 'flexible playoffs backfill: % playoff rows left without an address', v_bad;
  end if;
end;
$$;

alter table public.matchups drop constraint if exists matchups_playoff_address;
alter table public.matchups add constraint matchups_playoff_address check (
  -- Written with explicit IS [NOT] NULL on both branches: a CHECK that
  -- evaluates to NULL passes, so `round >= 1` alone would admit a NULL round.
  (coalesce(is_playoff, false)
     and playoff_round_number is not null and bracket_position is not null
     and playoff_round_number >= 1 and bracket_position >= 0)
  or
  (not coalesce(is_playoff, false)
     and playoff_round_number is null and bracket_position is null)
);

-- 4. Index swap (the new key is created first, so there is no window without one)
create unique index if not exists matchups_bracket_address
  on public.matchups (league_id, playoff_round_number, bracket_position)
  where is_playoff;
drop index if exists public.matchups_one_bracket_per_league;

-- 5. playoff_teams -----------------------------------------------------------
-- Runs as the migration owner: auth.uid() is NULL, so the F1 member column
-- guard (20260925000000) lets it through, as it does for service_role.
update public.leagues set playoff_teams = 4
 where league_type = 'matchup' and playoff_teams is null;

alter table public.leagues drop constraint if exists valid_playoff_teams;
alter table public.leagues add constraint valid_playoff_teams
  check (playoff_teams is null or playoff_teams >= 2);

alter table public.leagues drop constraint if exists leagues_matchup_requires_playoff_teams;
alter table public.leagues add constraint leagues_matchup_requires_playoff_teams
  check (league_type is distinct from 'matchup' or playoff_teams is not null);
