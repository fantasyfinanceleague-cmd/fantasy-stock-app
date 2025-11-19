-- Create trades table for post-draft trading system
CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('buy', 'sell')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price DECIMAL(10,2) NOT NULL CHECK (price > 0),
  total_value DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS trades_league_id_idx ON trades(league_id);
CREATE INDEX IF NOT EXISTS trades_user_id_idx ON trades(user_id);
CREATE INDEX IF NOT EXISTS trades_created_at_idx ON trades(created_at DESC);

-- Enable RLS
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view trades in leagues they're a member of
CREATE POLICY "Users can view trades in their leagues"
  ON trades
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM league_members
      WHERE league_members.league_id = trades.league_id
      AND league_members.user_id = auth.uid()::text
    )
  );

-- Policy: Users can insert trades in leagues they're a member of
CREATE POLICY "Users can create trades in their leagues"
  ON trades
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM league_members
      WHERE league_members.league_id = trades.league_id
      AND league_members.user_id = auth.uid()::text
    )
  );

-- Add comment
COMMENT ON TABLE trades IS 'Stores all buy/sell transactions after the draft completes';
