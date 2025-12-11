-- Add alpaca_order_id column to trades table to track Alpaca paper orders
ALTER TABLE trades ADD COLUMN IF NOT EXISTS alpaca_order_id TEXT;

-- Add index for looking up trades by Alpaca order ID
CREATE INDEX IF NOT EXISTS trades_alpaca_order_id_idx ON trades(alpaca_order_id) WHERE alpaca_order_id IS NOT NULL;
