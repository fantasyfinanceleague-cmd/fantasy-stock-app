-- Insert a test completed season for the "Test" league to preview History UI
-- This is test data that can be removed later

-- Insert completed season (Season 0 = "Preseason")
INSERT INTO league_seasons (league_id, season_number, champion_user_id, runner_up_user_id, started_at, completed_at, final_standings)
VALUES (
  'c9992e34-7073-48cb-a53a-18bf7ce23e69',  -- Test league
  0,  -- Season 0 (preseason/test)
  '769c3fad-b030-4038-aa87-1b5a057f0afb',  -- Champion: Giorgio
  'bot-1',  -- Runner-up: Bot 1
  '2025-11-01T00:00:00Z',
  '2025-12-15T00:00:00Z',
  '[
    {"user_id": "769c3fad-b030-4038-aa87-1b5a057f0afb", "rank": 1, "wins": 8, "losses": 2, "ties": 0, "points_for": 1245.50, "points_against": 890.25},
    {"user_id": "bot-1", "rank": 2, "wins": 7, "losses": 3, "ties": 0, "points_for": 1120.00, "points_against": 950.00},
    {"user_id": "9af1a7cb-8235-4361-8bb1-565308dfb2ab", "rank": 3, "wins": 5, "losses": 5, "ties": 0, "points_for": 980.00, "points_against": 1010.00},
    {"user_id": "bot-2", "rank": 4, "wins": 0, "losses": 10, "ties": 0, "points_for": 650.00, "points_against": 1150.00}
  ]'::jsonb
)
ON CONFLICT (league_id, season_number) DO UPDATE SET
  champion_user_id = EXCLUDED.champion_user_id,
  runner_up_user_id = EXCLUDED.runner_up_user_id,
  completed_at = EXCLUDED.completed_at,
  final_standings = EXCLUDED.final_standings;
