-- ============================================================================
-- DEFECT 3: snapshot-week-end has never recorded a mid-week purchase.
-- ============================================================================
--
-- week_snapshots.week_start_price is NOT NULL (20260105000000:14, never altered
-- -- confirmed against prod via information_schema on 2026-07-27). But
-- snapshot-week-end builds mid-week-purchase rows with `week_start_price: null`
-- and inserts them as their own batch, so that INSERT has failed on EVERY run
-- since 2026-01-15. It is caught, logged to console.error, and execution
-- continues -- and the per-league result still reports `newSnapshots: <attempted
-- count>`, so the response claims rows were created when none were.
--
-- SCORING CONSEQUENCE (this is not just a missing row):
-- calculateUserScore settles a mid-week buy held to Friday as
-- quantity * (endPrice - buy.price), and looks endPrice up in a map built ONLY
-- from snapshot rows. No row => `if (endPrice === undefined) continue` at
-- index.ts:365 => the position is dropped from BOTH totalGain and
-- totalStartValue. The user's dollar gain omits that stock entirely AND their
-- percent gain is computed over a basis that excludes it. Both numbers wrong,
-- silently, with no error and no NaN.
--
-- WHY A DISCRIMINATOR COLUMN AND NOT A NULLABLE week_start_price
-- The obvious repairs both fail:
--   (a) Write the purchase price into week_start_price to satisfy NOT NULL.
--       DOUBLE-COUNTS. calculateUserScore builds weekStartHoldings from
--       `weekStartPrice !== null` (index.ts:270), so the row would be treated as
--       a Monday holding and settled there -- while the SAME buy is already
--       carried in midWeekTrades and settled again at index.ts:361.
--   (b) Make week_start_price nullable, keeping NULL as the marker.
--       Preserves an overloaded NULL as a permanent type tag, keeps DEFECT 1
--       coupled to this change, and introduces a UI bug: Matchup.jsx:229,
--       matchup.tsx:308 and Dashboard.jsx:256 compute
--       `quantity * week_start_price` as cost basis with no null filter, so
--       Number(null) => 0 would render avg entry $0.00 and a "gain" equal to the
--       position's entire market value. Those rows do not exist today only
--       because the insert fails.
--
-- So: an EXPLICIT flag, and week_start_price carries the real entry price. The
-- NULL stops being a type tag, the UI cost basis becomes correct rather than
-- zero, and DEFECT 1 stays decoupled from this change.
-- ============================================================================

ALTER TABLE week_snapshots
  ADD COLUMN IF NOT EXISTS entered_mid_week BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN week_snapshots.entered_mid_week IS
  'True when the position was opened DURING the week rather than held at week open. '
  'For such rows week_start_price is the purchase entry price, not a Monday open '
  'price, and scoring must NOT treat them as week-start holdings -- the same buy is '
  'already carried in the trades list and would be counted twice.';

-- Backfill is intentionally omitted: no such row can exist, because the insert
-- that would have created one has always failed. Verified 2026-07-27 -- the
-- week-end coverage audit returned empty at 90 days and at 1 year.

-- ============================================================================
-- HUMAN ACTION -- Giorgio only.
-- ============================================================================
-- 1.  supabase db push --dry-run   (preview only)
--     supabase db push
--
-- 2.  Confirm the column landed and is NOT NULL with a default:
--       SELECT column_name, is_nullable, column_default
--         FROM information_schema.columns
--        WHERE table_schema='public' AND table_name='week_snapshots'
--          AND column_name='entered_mid_week';
--     EXPECTED: NO / false
--
-- 3.  DEPLOY ORDER MATTERS. Push this migration BEFORE deploying the updated
--     snapshot-week-end and process-week-results. The old function code ignores
--     the new column (it defaults false), so the migration is safe on its own;
--     the new function code writes it and would fail against the old schema.
--
-- 4.  Prove the fix on the next week-end run: a user who buys mid-week and holds
--     to Friday should now get a row with entered_mid_week = true, and their
--     score should include that position.
--       SELECT user_id, symbol, quantity, week_start_price, week_end_price
--         FROM week_snapshots
--        WHERE entered_mid_week ORDER BY created_at DESC LIMIT 20;
--     Before this change that query could only ever return zero rows.
--
-- 5.  Re-capture docs/architecture/db-snapshot.json (schema changed).
-- ============================================================================
