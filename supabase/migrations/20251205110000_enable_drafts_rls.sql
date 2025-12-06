-- Enable RLS for drafts, draft_sessions, and draft_settings tables
-- These tables were previously unrestricted

-- ============================================
-- DRAFTS TABLE (stores individual draft picks)
-- ============================================

ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;

-- Users can view all picks in leagues they're a member of
CREATE POLICY "Users can view picks in their leagues"
  ON drafts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM league_members
      WHERE league_members.league_id = drafts.league_id
      AND league_members.user_id = auth.uid()::text
    )
  );

-- Users can insert picks for themselves in leagues they're a member of
CREATE POLICY "Users can create picks in their leagues"
  ON drafts
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM league_members
      WHERE league_members.league_id = drafts.league_id
      AND league_members.user_id = auth.uid()::text
    )
  );

-- Allow bot picks (user_id starts with 'bot-') by any league member
-- This allows real users to trigger bot auto-picks
CREATE POLICY "League members can create bot picks"
  ON drafts
  FOR INSERT
  WITH CHECK (
    user_id LIKE 'bot-%'
    AND EXISTS (
      SELECT 1 FROM league_members
      WHERE league_members.league_id = drafts.league_id
      AND league_members.user_id = auth.uid()::text
    )
  );

-- Only commissioners can delete picks (for draft reset)
CREATE POLICY "Commissioners can delete picks"
  ON drafts
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = drafts.league_id
      AND leagues.commissioner_id = auth.uid()::text
    )
  );

-- ============================================
-- DRAFT_SESSIONS TABLE
-- ============================================

ALTER TABLE draft_sessions ENABLE ROW LEVEL SECURITY;

-- Users can view draft sessions for leagues they're a member of
CREATE POLICY "Users can view draft sessions in their leagues"
  ON draft_sessions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM league_members
      WHERE league_members.league_id = draft_sessions.league_id
      AND league_members.user_id = auth.uid()::text
    )
  );

-- Commissioners can create/update draft sessions
CREATE POLICY "Commissioners can manage draft sessions"
  ON draft_sessions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = draft_sessions.league_id
      AND leagues.commissioner_id = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = draft_sessions.league_id
      AND leagues.commissioner_id = auth.uid()::text
    )
  );

-- ============================================
-- DRAFT_SETTINGS TABLE
-- ============================================

ALTER TABLE draft_settings ENABLE ROW LEVEL SECURITY;

-- Users can view draft settings for leagues they're a member of
CREATE POLICY "Users can view draft settings in their leagues"
  ON draft_settings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM league_members
      WHERE league_members.league_id = draft_settings.league_id
      AND league_members.user_id = auth.uid()::text
    )
  );

-- Commissioners can manage draft settings
CREATE POLICY "Commissioners can manage draft settings"
  ON draft_settings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = draft_settings.league_id
      AND leagues.commissioner_id = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = draft_settings.league_id
      AND leagues.commissioner_id = auth.uid()::text
    )
  );
