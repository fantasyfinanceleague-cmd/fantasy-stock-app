-- DR-001 draftable-universe commissioner override.
--
-- The default draft universe is is_draftable symbols only (market-cap / price /
-- exchange floor, computed by the enrichment job). This column lets a commissioner
-- opt a league into the FULL symbol universe — picks and buys of non-draftable
-- symbols are then permitted. Enforced SERVER-SIDE: validate-and-record-pick and
-- record-trade both read leagues.allow_undraftable and bypass the is_draftable gate
-- when it is true (see supabase/functions/_shared/draft-validation.ts).
--
-- AUTHORED, NOT APPLIED. HUMAN ACTION: `supabase db push` after diff review.
-- Effect-verify (not the push output):
--   SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'leagues' AND column_name = 'allow_undraftable';
--   -> boolean, default false, NOT NULL.

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS allow_undraftable boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN leagues.allow_undraftable IS
  'DR-001 override: when true, picks/buys are NOT restricted to is_draftable symbols (full universe). Default false = draftable-only.';
