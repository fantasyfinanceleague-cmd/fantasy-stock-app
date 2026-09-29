-- ============================================================================
-- fixed_notional slot proceeds: track which SELL a BUY reinvests.
-- ============================================================================
--
-- THE BUG (2026-09-29, Giorgio via Orchestrator): draft-validation.ts
-- fillQuantity() sizes EVERY fixed_notional buy at notional_per_slot / price
-- -- a fresh full slot -- regardless of what was sold to free the slot. Sell
-- a position worth $1,500 (started at $2,000) and rebuy, and the rebuy is
-- $2,000 of new stock -- $500 created. Sell one worth $2,500 and the rebuy is
-- capped at $2,000 -- $500 destroyed.
--
-- THE RULE (Giorgio, product decision): a replacement buy in a fixed_notional
-- league reinvests exactly the SALE PROCEEDS of the slot it fills -- "if it
-- started at $2000 per slot and I sold when it was worth $1500, I can buy
-- whatever stock I want but it'll only be $1500 worth of it." Unreinvested
-- proceeds are cash that earns nothing; a slot the user voluntarily SKIPPED
-- at draft time still funds a fresh buy at the full notional, because nothing
-- was ever sold to reduce it.
--
-- funded_by_trade_id is WRITE-ONCE (record-trade sets it on INSERT; there is
-- no client or server UPDATE path into trades -- the 20260811000002 client
-- INSERT-policy drop already removed the only non-admin write path). It is a
-- ledger fact, not a mutable balance, and is never rewritten after insert.
--
-- NULL DISCIPLINE (CLAUDE.md "overloaded NULLs are type tags, and you cannot
-- fill them in"): funded_by_trade_id IS NULL reads exactly one way --
-- "consumed the oldest unclaimed sale proceeds at that moment (FIFO), or, if
-- none existed, filled a voluntarily-skipped draft slot at full notional."
-- record-trade writes NULL ONLY when both are absent, which is what keeps
-- that single reading true for every future row. A handful of pre-fix rows
-- may not satisfy the invariant (the old bug could overbuy past a partial
-- sale) -- those replay as consuming nothing, per the "never rewrite applied
-- history" rule (CLAUDE.md: "we do not rewrite applied migrations to fix
-- their headers" -- the same principle applies to historical trade rows).
-- supabase/functions/_shared/draft-validation.ts fixedNotionalFunding()
-- documents the replay in full.
--
-- THE UNIQUE INDEX is a database backstop, not just bookkeeping: it makes
-- spending the same sale's proceeds twice fail at INSERT (Postgres 23505,
-- mapped by record-trade to the 'proceeds_unavailable' refusal) instead of
-- silently creating money -- and since one SELL frees exactly one roster
-- slot, it also closes the part of the STATUS.md #10 concurrent-buy race
-- where two buys could both fund themselves from, and overfill, the same
-- freed slot. It does NOT close the cross-user same-symbol race (STATUS.md
-- #10, narrowed by this change to exactly that case) -- that still needs the
-- atomic SECURITY DEFINER RPC follow-up.
-- ============================================================================

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS funded_by_trade_id UUID REFERENCES trades (id);

ALTER TABLE trades
  DROP CONSTRAINT IF EXISTS trades_funded_by_trade_id_buy_only;
ALTER TABLE trades
  ADD CONSTRAINT trades_funded_by_trade_id_buy_only
    CHECK (funded_by_trade_id IS NULL OR action = 'buy');

-- A sale's proceeds can fund at most one buy -- the money-safety backstop.
CREATE UNIQUE INDEX IF NOT EXISTS trades_funded_by_trade_id_unique
  ON trades (funded_by_trade_id)
  WHERE funded_by_trade_id IS NOT NULL;

COMMENT ON COLUMN trades.funded_by_trade_id IS
  'fixed_notional only: the SELL trade whose proceeds fund this BUY. NULL means '
  '"consumed the oldest unclaimed proceeds at insert time, or filled a '
  'voluntarily-skipped draft slot at full notional" -- see the NULL DISCIPLINE '
  'note above and fixedNotionalFunding() in _shared/draft-validation.ts. '
  'Write-once; never updated after insert.';

-- Backfill is intentionally omitted: every existing trades row predates this
-- column and is correctly read as NULL under the discipline above -- the
-- fixedNotionalFunding() replay, not a backfill, is what makes historical
-- rows interpretable.

-- ============================================================================
-- HUMAN ACTION -- Giorgio only.
-- ============================================================================
-- 1.  From /Users/giorgio/fantasy-stock-deploy, refreshed first:
--       git fetch origin && git checkout --detach origin/main
--     supabase db push --dry-run   (preview only -- confirm it shows exactly
--       this file, 20261006000000_trades_funded_by_trade_id.sql)
--     supabase db push
--
-- 2.  Confirm the column, check constraint and unique index landed (dry-run
--     output and "Remote database is up to date" are not proof -- CLAUDE.md
--     "verify the ACTUAL state"):
--       SELECT column_name, is_nullable, data_type
--         FROM information_schema.columns
--        WHERE table_schema='public' AND table_name='trades'
--          AND column_name='funded_by_trade_id';
--       SELECT conname, pg_get_constraintdef(oid)
--         FROM pg_constraint
--        WHERE conrelid = 'public.trades'::regclass
--          AND conname = 'trades_funded_by_trade_id_buy_only';
--       SELECT indexname, indexdef FROM pg_indexes
--        WHERE tablename = 'trades' AND indexname = 'trades_funded_by_trade_id_unique';
--     EXPECTED: nullable uuid column; the CHECK definition above; a UNIQUE
--     INDEX ... WHERE (funded_by_trade_id IS NOT NULL).
--
-- 3.  DEPLOY ORDER MATTERS. Push this migration BEFORE deploying the updated
--     record-trade. The old function code never selects or writes
--     funded_by_trade_id, so the migration is safe on its own (column
--     defaults NULL on every existing and new row until the new function
--     ships); the new function selects and inserts it and would fail against
--     the old schema.
--
-- 4.  Run the READ-ONLY prod audit query from this branch's PR description /
--     DONE report (fixed_notional leagues where a buy followed a sell,
--     quantifying dollars created or destroyed by the old sizing). It
--     changes nothing -- decide separately whether any correction is needed.
--
-- 5.  Re-capture docs/architecture/db-snapshot.json (schema changed).
-- ============================================================================
