-- Add 'playoffs' to season_status CHECK constraint
ALTER TABLE leagues DROP CONSTRAINT IF EXISTS leagues_season_status_check;
ALTER TABLE leagues ADD CONSTRAINT leagues_season_status_check
  CHECK (season_status IN ('active', 'playoffs', 'completed'));
