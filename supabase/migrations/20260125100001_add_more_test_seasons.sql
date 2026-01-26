-- Add two more test completed seasons to preview different finishes
-- Season -1: User got 2nd place
-- Season -2: User got 4th place

-- Season -1: User finished 2nd place
INSERT INTO league_seasons (league_id, season_number, champion_user_id, runner_up_user_id, started_at, completed_at, final_standings)
VALUES (
  'c9992e34-7073-48cb-a53a-18bf7ce23e69',  -- Test league
  -1,  -- Season -1
  'bot-1',  -- Champion: Bot 1
  '769c3fad-b030-4038-aa87-1b5a057f0afb',  -- Runner-up: Giorgio (user)
  '2025-08-01T00:00:00Z',
  '2025-10-15T00:00:00Z',
  '[
    {"user_id": "bot-1", "rank": 1, "wins": 9, "losses": 1, "ties": 0, "points_for": 1450.00, "points_against": 720.00},
    {"user_id": "769c3fad-b030-4038-aa87-1b5a057f0afb", "rank": 2, "wins": 7, "losses": 3, "ties": 0, "points_for": 1120.50, "points_against": 890.25},
    {"user_id": "9af1a7cb-8235-4361-8bb1-565308dfb2ab", "rank": 3, "wins": 3, "losses": 7, "ties": 0, "points_for": 780.00, "points_against": 1010.00},
    {"user_id": "bot-2", "rank": 4, "wins": 1, "losses": 9, "ties": 0, "points_for": 550.00, "points_against": 1280.00}
  ]'::jsonb
)
ON CONFLICT (league_id, season_number) DO UPDATE SET
  champion_user_id = EXCLUDED.champion_user_id,
  runner_up_user_id = EXCLUDED.runner_up_user_id,
  completed_at = EXCLUDED.completed_at,
  final_standings = EXCLUDED.final_standings;

-- Season -2: User finished 4th place
INSERT INTO league_seasons (league_id, season_number, champion_user_id, runner_up_user_id, started_at, completed_at, final_standings)
VALUES (
  'c9992e34-7073-48cb-a53a-18bf7ce23e69',  -- Test league
  -2,  -- Season -2
  '9af1a7cb-8235-4361-8bb1-565308dfb2ab',  -- Champion: Other user
  'bot-2',  -- Runner-up: Bot 2
  '2025-05-01T00:00:00Z',
  '2025-07-15T00:00:00Z',
  '[
    {"user_id": "9af1a7cb-8235-4361-8bb1-565308dfb2ab", "rank": 1, "wins": 8, "losses": 2, "ties": 0, "points_for": 1320.00, "points_against": 650.00},
    {"user_id": "bot-2", "rank": 2, "wins": 6, "losses": 4, "ties": 0, "points_for": 1050.00, "points_against": 920.00},
    {"user_id": "bot-1", "rank": 3, "wins": 4, "losses": 6, "ties": 0, "points_for": 890.00, "points_against": 1100.00},
    {"user_id": "769c3fad-b030-4038-aa87-1b5a057f0afb", "rank": 4, "wins": 2, "losses": 8, "ties": 0, "points_for": 640.00, "points_against": 1230.00}
  ]'::jsonb
)
ON CONFLICT (league_id, season_number) DO UPDATE SET
  champion_user_id = EXCLUDED.champion_user_id,
  runner_up_user_id = EXCLUDED.runner_up_user_id,
  completed_at = EXCLUDED.completed_at,
  final_standings = EXCLUDED.final_standings;
