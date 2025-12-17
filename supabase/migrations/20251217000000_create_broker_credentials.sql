-- Create broker_credentials table for storing encrypted API keys per user
CREATE TABLE IF NOT EXISTS broker_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker TEXT NOT NULL DEFAULT 'alpaca',
  key_id TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Each user can only have one set of credentials per broker
  UNIQUE(user_id, broker)
);

-- Enable RLS
ALTER TABLE broker_credentials ENABLE ROW LEVEL SECURITY;

-- Users can only view their own credentials
CREATE POLICY "Users can view own credentials"
  ON broker_credentials FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own credentials
CREATE POLICY "Users can insert own credentials"
  ON broker_credentials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own credentials
CREATE POLICY "Users can update own credentials"
  ON broker_credentials FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own credentials
CREATE POLICY "Users can delete own credentials"
  ON broker_credentials FOR DELETE
  USING (auth.uid() = user_id);

-- Index for faster lookups
CREATE INDEX idx_broker_credentials_user_broker ON broker_credentials(user_id, broker);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_broker_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER broker_credentials_updated_at
  BEFORE UPDATE ON broker_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_broker_credentials_updated_at();
