-- =============================================================================
-- SEASON SIMULATION: Seed Test League
-- =============================================================================
-- Creates a complete test league with 4 players, 3 regular season weeks,
-- 4 playoff teams. All matchup dates are in the past so process-week-results
-- can process them immediately.
--
-- Usage: Run in Supabase SQL Editor, then run simulate-season.sh
-- =============================================================================

-- Fixed IDs for deterministic cleanup
DO $$
DECLARE
  v_league_id UUID := 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  v_season_id UUID := 'aaaaaaaa-bbbb-cccc-dddd-ffffffffffff';
  v_commissioner TEXT := '769c3fad-b030-4038-aa87-1b5a057f0afb';
  v_user1 TEXT := 'test-user-1';
  v_user2 TEXT := 'test-user-2';
  v_user3 TEXT := 'test-user-3';
  v_base_date TIMESTAMPTZ := now() - interval '8 weeks';
BEGIN

  -- =========================================================================
  -- CLEANUP: Remove any existing test league data
  -- =========================================================================
  DELETE FROM matchups WHERE league_id = v_league_id;
  DELETE FROM week_snapshots WHERE league_id = v_league_id;
  DELETE FROM drafts WHERE league_id = v_league_id;
  DELETE FROM league_standings WHERE league_id = v_league_id;
  UPDATE leagues SET current_season_id = NULL WHERE id = v_league_id;
  DELETE FROM league_seasons WHERE league_id = v_league_id;
  DELETE FROM league_members WHERE league_id = v_league_id;
  DELETE FROM leagues WHERE id = v_league_id;

  RAISE NOTICE 'Cleaned up existing test data';

  -- =========================================================================
  -- 1. CREATE LEAGUE
  -- =========================================================================
  INSERT INTO leagues (
    id, name, commissioner_id, invite_code,
    num_participants, num_rounds, num_weeks, playoff_teams,
    league_type, budget_mode, budget_amount,
    draft_status, current_week, season_status,
    draft_date, duration_days
  ) VALUES (
    v_league_id, '__TEST_SIMULATION__', v_commissioner, 'TESTSM',
    4, 2, 3, 4,
    'matchup', 'no-budget', 100000,
    'completed', 1, 'active',
    v_base_date, 30
  );

  RAISE NOTICE 'Created league';

  -- =========================================================================
  -- 2. ADD MEMBERS
  -- =========================================================================
  INSERT INTO league_members (league_id, user_id, role) VALUES
    (v_league_id, v_commissioner, 'commissioner'),
    (v_league_id, v_user1, 'member'),
    (v_league_id, v_user2, 'member'),
    (v_league_id, v_user3, 'member');

  RAISE NOTICE 'Added 4 members';

  -- =========================================================================
  -- 3. CREATE SEASON
  -- =========================================================================
  INSERT INTO league_seasons (id, league_id, season_number)
  VALUES (v_season_id, v_league_id, 1);

  UPDATE leagues SET current_season_id = v_season_id WHERE id = v_league_id;

  RAISE NOTICE 'Created season 1';

  -- =========================================================================
  -- 4. INITIALIZE STANDINGS
  -- =========================================================================
  INSERT INTO league_standings (league_id, user_id, wins, losses, ties, points_for, points_against)
  VALUES
    (v_league_id, v_commissioner, 0, 0, 0, 0, 0),
    (v_league_id, v_user1, 0, 0, 0, 0, 0),
    (v_league_id, v_user2, 0, 0, 0, 0, 0),
    (v_league_id, v_user3, 0, 0, 0, 0, 0);

  RAISE NOTICE 'Initialized standings';

  -- =========================================================================
  -- 5. INSERT DRAFT PICKS (snake draft: 2 rounds, 4 users)
  -- =========================================================================
  -- Round 1: commissioner -> user1 -> user2 -> user3
  -- Round 2: user3 -> user2 -> user1 -> commissioner
  INSERT INTO drafts (league_id, user_id, symbol, entry_price, quantity, round, pick_number)
  VALUES
    (v_league_id, v_commissioner, 'AAPL', 150.00, 1, 1, 1),
    (v_league_id, v_user1,        'GOOG', 140.00, 1, 1, 2),
    (v_league_id, v_user2,        'TSLA', 250.00, 1, 1, 3),
    (v_league_id, v_user3,        'META', 500.00, 1, 1, 4),
    (v_league_id, v_user3,        'NFLX', 600.00, 1, 2, 5),
    (v_league_id, v_user2,        'NVDA', 800.00, 1, 2, 6),
    (v_league_id, v_user1,        'AMZN', 180.00, 1, 2, 7),
    (v_league_id, v_commissioner, 'MSFT', 400.00, 1, 2, 8);

  RAISE NOTICE 'Inserted 8 draft picks';

  -- =========================================================================
  -- 6. CREATE MATCHUPS (round-robin, 4 teams, 3 weeks)
  -- =========================================================================
  -- All dates in the past so process-week-results will pick them up.
  -- Week timing: Tuesday 14:30 UTC -> Friday 21:00 UTC

  -- Week 1 (6 weeks ago)
  INSERT INTO matchups (league_id, week_number, team1_user_id, team2_user_id, week_start, week_end)
  VALUES
    (v_league_id, 1, v_commissioner, v_user3,
     v_base_date + interval '2 days' + time '14:30',   -- Tuesday
     v_base_date + interval '5 days' + time '21:00'),  -- Friday
    (v_league_id, 1, v_user1, v_user2,
     v_base_date + interval '2 days' + time '14:30',
     v_base_date + interval '5 days' + time '21:00');

  -- Week 2 (5 weeks ago)
  INSERT INTO matchups (league_id, week_number, team1_user_id, team2_user_id, week_start, week_end)
  VALUES
    (v_league_id, 2, v_commissioner, v_user2,
     v_base_date + interval '9 days' + time '14:30',
     v_base_date + interval '12 days' + time '21:00'),
    (v_league_id, 2, v_user3, v_user1,
     v_base_date + interval '9 days' + time '14:30',
     v_base_date + interval '12 days' + time '21:00');

  -- Week 3 (4 weeks ago)
  INSERT INTO matchups (league_id, week_number, team1_user_id, team2_user_id, week_start, week_end)
  VALUES
    (v_league_id, 3, v_commissioner, v_user1,
     v_base_date + interval '16 days' + time '14:30',
     v_base_date + interval '19 days' + time '21:00'),
    (v_league_id, 3, v_user2, v_user3,
     v_base_date + interval '16 days' + time '14:30',
     v_base_date + interval '19 days' + time '21:00');

  RAISE NOTICE 'Created 6 matchups (3 weeks x 2 per week)';

  -- =========================================================================
  -- 7. CREATE WEEK SNAPSHOTS (mock prices)
  -- =========================================================================
  -- Each user holds 2 stocks with quantity 1.
  -- Gains are designed to produce varied results:
  --
  -- Week 1: commissioner +$50, user1 +$20, user2 +$35, user3 +$15
  --   Matchups: commissioner($50) vs user3($15) -> commissioner wins
  --             user1($20) vs user2($35) -> user2 wins
  --
  -- Week 2: commissioner +$30, user1 +$45, user2 +$25, user3 +$10
  --   Matchups: commissioner($30) vs user2($25) -> commissioner wins
  --             user3($10) vs user1($45) -> user1 wins
  --
  -- Week 3: commissioner +$40, user1 +$35, user2 +$10, user3 +$20
  --   Matchups: commissioner($40) vs user1($35) -> commissioner wins
  --             user2($10) vs user3($20) -> user3 wins
  --
  -- Expected standings: commissioner 3-0, user1 1-2, user2 1-2, user3 1-2
  -- Seeding by points_for tiebreaker:
  --   1. commissioner (3-0, PF=120)
  --   2. user1 (1-2, PF=100)
  --   3. user2 (1-2, PF=70)
  --   4. user3 (1-2, PF=45)

  -- ---- WEEK 1 snapshots ----
  -- Commissioner: AAPL 150->175 (+25), MSFT 400->425 (+25) = +50
  INSERT INTO week_snapshots (league_id, user_id, week_number, symbol, quantity, week_start_price, week_end_price)
  VALUES
    (v_league_id, v_commissioner, 1, 'AAPL', 1, 150.00, 175.00),
    (v_league_id, v_commissioner, 1, 'MSFT', 1, 400.00, 425.00);

  -- User1: GOOG 140->150 (+10), AMZN 180->190 (+10) = +20
  INSERT INTO week_snapshots (league_id, user_id, week_number, symbol, quantity, week_start_price, week_end_price)
  VALUES
    (v_league_id, v_user1, 1, 'GOOG', 1, 140.00, 150.00),
    (v_league_id, v_user1, 1, 'AMZN', 1, 180.00, 190.00);

  -- User2: TSLA 250->270 (+20), NVDA 800->815 (+15) = +35
  INSERT INTO week_snapshots (league_id, user_id, week_number, symbol, quantity, week_start_price, week_end_price)
  VALUES
    (v_league_id, v_user2, 1, 'TSLA', 1, 250.00, 270.00),
    (v_league_id, v_user2, 1, 'NVDA', 1, 800.00, 815.00);

  -- User3: META 500->510 (+10), NFLX 600->605 (+5) = +15
  INSERT INTO week_snapshots (league_id, user_id, week_number, symbol, quantity, week_start_price, week_end_price)
  VALUES
    (v_league_id, v_user3, 1, 'META', 1, 500.00, 510.00),
    (v_league_id, v_user3, 1, 'NFLX', 1, 600.00, 605.00);

  -- ---- WEEK 2 snapshots ----
  -- Commissioner: AAPL 175->190 (+15), MSFT 425->440 (+15) = +30
  INSERT INTO week_snapshots (league_id, user_id, week_number, symbol, quantity, week_start_price, week_end_price)
  VALUES
    (v_league_id, v_commissioner, 2, 'AAPL', 1, 175.00, 190.00),
    (v_league_id, v_commissioner, 2, 'MSFT', 1, 425.00, 440.00);

  -- User1: GOOG 150->175 (+25), AMZN 190->210 (+20) = +45
  INSERT INTO week_snapshots (league_id, user_id, week_number, symbol, quantity, week_start_price, week_end_price)
  VALUES
    (v_league_id, v_user1, 2, 'GOOG', 1, 150.00, 175.00),
    (v_league_id, v_user1, 2, 'AMZN', 1, 190.00, 210.00);

  -- User2: TSLA 270->285 (+15), NVDA 815->825 (+10) = +25
  INSERT INTO week_snapshots (league_id, user_id, week_number, symbol, quantity, week_start_price, week_end_price)
  VALUES
    (v_league_id, v_user2, 2, 'TSLA', 1, 270.00, 285.00),
    (v_league_id, v_user2, 2, 'NVDA', 1, 815.00, 825.00);

  -- User3: META 510->515 (+5), NFLX 605->610 (+5) = +10
  INSERT INTO week_snapshots (league_id, user_id, week_number, symbol, quantity, week_start_price, week_end_price)
  VALUES
    (v_league_id, v_user3, 2, 'META', 1, 510.00, 515.00),
    (v_league_id, v_user3, 2, 'NFLX', 1, 605.00, 610.00);

  -- ---- WEEK 3 snapshots ----
  -- Commissioner: AAPL 190->210 (+20), MSFT 440->460 (+20) = +40
  INSERT INTO week_snapshots (league_id, user_id, week_number, symbol, quantity, week_start_price, week_end_price)
  VALUES
    (v_league_id, v_commissioner, 3, 'AAPL', 1, 190.00, 210.00),
    (v_league_id, v_commissioner, 3, 'MSFT', 1, 440.00, 460.00);

  -- User1: GOOG 175->195 (+20), AMZN 210->225 (+15) = +35
  INSERT INTO week_snapshots (league_id, user_id, week_number, symbol, quantity, week_start_price, week_end_price)
  VALUES
    (v_league_id, v_user1, 3, 'GOOG', 1, 175.00, 195.00),
    (v_league_id, v_user1, 3, 'AMZN', 1, 210.00, 225.00);

  -- User2: TSLA 285->290 (+5), NVDA 825->830 (+5) = +10
  INSERT INTO week_snapshots (league_id, user_id, week_number, symbol, quantity, week_start_price, week_end_price)
  VALUES
    (v_league_id, v_user2, 3, 'TSLA', 1, 285.00, 290.00),
    (v_league_id, v_user2, 3, 'NVDA', 1, 825.00, 830.00);

  -- User3: META 515->525 (+10), NFLX 610->620 (+10) = +20
  INSERT INTO week_snapshots (league_id, user_id, week_number, symbol, quantity, week_start_price, week_end_price)
  VALUES
    (v_league_id, v_user3, 3, 'META', 1, 515.00, 525.00),
    (v_league_id, v_user3, 3, 'NFLX', 1, 610.00, 620.00);

  RAISE NOTICE 'Created 24 week snapshots (8 per week x 3 weeks)';

  -- =========================================================================
  -- DONE
  -- =========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST LEAGUE SEEDED SUCCESSFULLY ===';
  RAISE NOTICE 'League ID: %', v_league_id;
  RAISE NOTICE 'Members: 4 (commissioner + 3 test users)';
  RAISE NOTICE 'Regular season: 3 weeks, 6 matchups';
  RAISE NOTICE 'Playoff teams: 4 (semis + finals)';
  RAISE NOTICE '';
  RAISE NOTICE 'Next: Run scripts/simulate-season.sh to process all weeks';

END $$;
