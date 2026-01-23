-- Add push notification token storage to user_profiles
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS expo_push_token TEXT,
ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT true;

-- Create index for quick token lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_push_token ON user_profiles(expo_push_token);

-- Create table to track sent notifications (optional, for debugging/history)
CREATE TABLE IF NOT EXISTS notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  notification_type TEXT NOT NULL, -- 'draft_turn', 'matchup_result', 'league_invite', etc.
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB,
  sent_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'sent' -- 'sent', 'failed', 'delivered'
);

-- Index for querying notification history
CREATE INDEX IF NOT EXISTS idx_notification_log_user ON notification_log(user_id, sent_at DESC);

-- Enable RLS on notification_log
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notifications
CREATE POLICY "Users can view own notifications" ON notification_log
  FOR SELECT USING (user_id = auth.uid()::text);

-- Service role can insert notifications
CREATE POLICY "Service role can insert notifications" ON notification_log
  FOR INSERT WITH CHECK (true);

COMMENT ON COLUMN user_profiles.expo_push_token IS 'Expo push notification token for this user';
COMMENT ON COLUMN user_profiles.notifications_enabled IS 'Whether the user wants to receive push notifications';
