-- In-house simulator (DR-001 / SIMULATOR_MIGRATION_SPEC Phase 2)
-- Binding consequence #1 (simulator-recon.md, Phase 0.5).
--
-- WHAT: widen the position-quantity columns integer -> numeric.
--   drafts.quantity : integer NOT NULL  -> numeric NOT NULL
--   trades.quantity : integer NOT NULL  -> numeric NOT NULL
--
-- WHY: fixed_notional stake mode buys a fixed dollar stake per slot
--   (quantity = notional_per_slot / entry_price), which is fractional. The
--   integer columns truncate fractional shares. week_snapshots.quantity is
--   ALREADY numeric(12,6) (verified in Phase 0.5) — intentionally NOT touched
--   here.
--
-- SAFETY: integer -> numeric is a lossless widening; every existing integer
--   value survives the USING cast unchanged. Both columns are confirmed to
--   EXIST (Phase 0.5 information_schema paste), so this is ALTER TYPE, not a
--   guarded ADD COLUMN. Existing CHECK constraints (trades: quantity > 0) are
--   preserved and re-validated automatically by the type change.
--
-- HUMAN ACTION: `supabase db push` is Giorgio's. Effect-verify with:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name IN ('drafts','trades') AND column_name = 'quantity';
--   -- both must read 'numeric'.

alter table drafts alter column quantity type numeric using quantity::numeric;
alter table trades alter column quantity type numeric using quantity::numeric;
