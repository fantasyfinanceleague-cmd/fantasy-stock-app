-- Add unique constraint on (league_id, pick_number) to prevent duplicate picks
-- This prevents race conditions where multiple bot picks could be inserted with the same pick_number

-- First, check if there are any duplicate pick_numbers per league and log them
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT league_id, pick_number, COUNT(*) as cnt
    FROM drafts
    GROUP BY league_id, pick_number
    HAVING COUNT(*) > 1
  ) duplicates;

  IF dup_count > 0 THEN
    RAISE NOTICE 'Found % league/pick_number combinations with duplicates. These need manual cleanup before adding constraint.', dup_count;
  END IF;
END $$;

-- Add the unique constraint (will fail if duplicates exist - need manual cleanup first)
-- Uncomment the line below after cleaning up any existing duplicates:
-- ALTER TABLE drafts ADD CONSTRAINT drafts_league_pick_unique UNIQUE (league_id, pick_number);

-- For now, create a partial unique index that will prevent future duplicates
-- This allows existing duplicates to remain while preventing new ones
CREATE UNIQUE INDEX IF NOT EXISTS drafts_league_pick_unique_idx
ON drafts (league_id, pick_number)
WHERE created_at > '2026-01-08';
