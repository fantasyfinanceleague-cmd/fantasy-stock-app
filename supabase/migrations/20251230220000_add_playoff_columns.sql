-- Migration: Add playoff support columns
-- Run this in Supabase SQL Editor

-- Add playoff configuration to leagues table
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS playoff_teams INT DEFAULT 4;
-- Number of teams in playoffs: 2, 4, or 8

-- Add playoff context to matchups table
ALTER TABLE matchups ADD COLUMN IF NOT EXISTS is_playoff BOOLEAN DEFAULT FALSE;
ALTER TABLE matchups ADD COLUMN IF NOT EXISTS playoff_round TEXT;
-- 'finals', 'semi', 'quarter' (null for regular season)
ALTER TABLE matchups ADD COLUMN IF NOT EXISTS team1_seed INT;
ALTER TABLE matchups ADD COLUMN IF NOT EXISTS team2_seed INT;

-- Add constraint for valid playoff_teams values
ALTER TABLE leagues DROP CONSTRAINT IF EXISTS valid_playoff_teams;
ALTER TABLE leagues ADD CONSTRAINT valid_playoff_teams
  CHECK (playoff_teams IS NULL OR playoff_teams IN (2, 4, 8));

-- Add constraint for valid playoff_round values
ALTER TABLE matchups DROP CONSTRAINT IF EXISTS valid_playoff_round;
ALTER TABLE matchups ADD CONSTRAINT valid_playoff_round
  CHECK (playoff_round IS NULL OR playoff_round IN ('quarter', 'semi', 'finals'));
