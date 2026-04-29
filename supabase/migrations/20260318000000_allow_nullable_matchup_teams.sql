-- Allow nullable team1_user_id and team2_user_id in matchups table
-- This is needed for playoff bracket placeholder matchups (e.g., finals placeholder
-- created when generating playoffs, with team slots filled as winners advance).

ALTER TABLE matchups ALTER COLUMN team1_user_id DROP NOT NULL;
ALTER TABLE matchups ALTER COLUMN team2_user_id DROP NOT NULL;
