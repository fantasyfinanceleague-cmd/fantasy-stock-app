-- Migration: Add league seasons support for multi-season tracking
-- Allows leagues to have multiple seasons with champion/runner-up tracking

-- Create league_seasons table to track multiple seasons per league
CREATE TABLE IF NOT EXISTS league_seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  season_number INT NOT NULL DEFAULT 1,
  champion_user_id TEXT,
  runner_up_user_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  final_standings JSONB,  -- Snapshot of final standings [{user_id, rank, wins, losses, ties, points_for}]
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(league_id, season_number)
);

-- Add current season tracking to leagues table
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS current_season_id UUID REFERENCES league_seasons(id);
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS season_status TEXT DEFAULT 'active'
  CHECK (season_status IN ('active', 'completed'));

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_league_seasons_league ON league_seasons(league_id);
CREATE INDEX IF NOT EXISTS idx_league_seasons_champion ON league_seasons(champion_user_id) WHERE champion_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leagues_season_status ON leagues(season_status);

-- Backfill: Create season 1 records for all existing leagues with draft completed
INSERT INTO league_seasons (league_id, season_number, started_at)
SELECT id, 1, COALESCE(draft_date, created_at)
FROM leagues
WHERE draft_status = 'completed'
ON CONFLICT (league_id, season_number) DO NOTHING;

-- Update leagues to point to their season 1 record
UPDATE leagues l
SET current_season_id = ls.id
FROM league_seasons ls
WHERE ls.league_id = l.id
  AND ls.season_number = 1
  AND l.current_season_id IS NULL;

-- Enable realtime for league_seasons table
ALTER PUBLICATION supabase_realtime ADD TABLE league_seasons;

-- Add RLS policies for league_seasons
ALTER TABLE league_seasons ENABLE ROW LEVEL SECURITY;

-- Anyone can read league seasons for leagues they're a member of
CREATE POLICY "Users can view league seasons for their leagues" ON league_seasons
  FOR SELECT
  USING (
    league_id IN (
      SELECT league_id FROM league_members WHERE user_id = auth.uid()::text
    )
  );

-- Only commissioners can insert/update league seasons
CREATE POLICY "Commissioners can manage league seasons" ON league_seasons
  FOR ALL
  USING (
    league_id IN (
      SELECT id FROM leagues WHERE commissioner_id = auth.uid()::text
    )
  );

-- Function to complete a season and record champion
CREATE OR REPLACE FUNCTION complete_league_season(
  p_league_id UUID,
  p_champion_user_id TEXT,
  p_runner_up_user_id TEXT
) RETURNS void AS $$
DECLARE
  v_season_id UUID;
  v_standings JSONB;
BEGIN
  -- Get current season id
  SELECT current_season_id INTO v_season_id
  FROM leagues
  WHERE id = p_league_id;

  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'League has no active season';
  END IF;

  -- Snapshot final standings
  SELECT json_agg(
    json_build_object(
      'user_id', user_id,
      'rank', row_number() OVER (ORDER BY wins DESC, points_for DESC),
      'wins', wins,
      'losses', losses,
      'ties', ties,
      'points_for', points_for,
      'points_against', points_against
    )
  ) INTO v_standings
  FROM league_standings
  WHERE league_id = p_league_id
  ORDER BY wins DESC, points_for DESC;

  -- Update season record
  UPDATE league_seasons
  SET
    champion_user_id = p_champion_user_id,
    runner_up_user_id = p_runner_up_user_id,
    completed_at = now(),
    final_standings = v_standings
  WHERE id = v_season_id;

  -- Update league status
  UPDATE leagues
  SET season_status = 'completed'
  WHERE id = p_league_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to start a new season
CREATE OR REPLACE FUNCTION start_new_league_season(
  p_league_id UUID
) RETURNS UUID AS $$
DECLARE
  v_new_season_id UUID;
  v_new_season_number INT;
BEGIN
  -- Check if current season is completed
  IF NOT EXISTS (
    SELECT 1 FROM leagues
    WHERE id = p_league_id AND season_status = 'completed'
  ) THEN
    RAISE EXCEPTION 'Current season must be completed before starting a new one';
  END IF;

  -- Get next season number
  SELECT COALESCE(MAX(season_number), 0) + 1 INTO v_new_season_number
  FROM league_seasons
  WHERE league_id = p_league_id;

  -- Create new season record
  INSERT INTO league_seasons (league_id, season_number)
  VALUES (p_league_id, v_new_season_number)
  RETURNING id INTO v_new_season_id;

  -- Reset league standings
  UPDATE league_standings
  SET wins = 0, losses = 0, ties = 0, points_for = 0, points_against = 0, updated_at = now()
  WHERE league_id = p_league_id;

  -- Delete old matchups (keep history via league_seasons.final_standings)
  DELETE FROM matchups WHERE league_id = p_league_id;

  -- Reset league state
  UPDATE leagues
  SET
    current_season_id = v_new_season_id,
    season_status = 'active',
    current_week = 1
  WHERE id = p_league_id;

  RETURN v_new_season_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
