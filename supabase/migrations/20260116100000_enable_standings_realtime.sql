-- Enable realtime for standings and matchup tables
-- This allows the frontend to subscribe to live updates

-- Add league_standings to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE league_standings;

-- Add matchups to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE matchups;

-- Note: leagues table should already be in the publication
-- If not, uncomment the line below:
-- ALTER PUBLICATION supabase_realtime ADD TABLE leagues;
