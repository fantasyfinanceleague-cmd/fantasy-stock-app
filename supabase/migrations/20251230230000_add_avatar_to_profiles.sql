-- Add avatar column to user_profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT '📊';
