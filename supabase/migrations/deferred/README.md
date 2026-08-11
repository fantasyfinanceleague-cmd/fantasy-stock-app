# Deferred migrations — authored but NOT in the apply path

Files in this directory are **intentionally held out of `supabase db push`.** The
Supabase CLI applies only the timestamped `.sql` files directly in
`supabase/migrations/`; anything in this subdirectory is ignored by `db push`.
Do **not** move a file back to the parent directory until its stated precondition
is met.

## `20260808000001_drop_broker_credentials.sql`

**Do not apply until the `quote` → app-key rewire lands (Phase 3).**

This migration drops the `broker_credentials` table (and its
`update_broker_credentials_updated_at` trigger function). It is correct and
safe *in itself*, but applying it now would break live prices app-wide, per the
**Gap 2** findings in `docs/migrations/simulator-recon.md`:

- The `quote` edge function reads `broker_credentials` via `getUserCredentials()`
  and has **no `ALPACA_API_KEY` fallback** (`supabase/functions/quote/index.ts`).
  Dropping the table makes `quote` return `no_credentials`/error for **every**
  user.
- `quote` is the app's **primary live-price path** — **10 client call sites**
  depend on it, including the global `PriceContext`, matchup live prices, and
  draft pricing — and none has an effective app-key fallback (the one
  `finnhub-quote` fallback in `DraftPage` is bypassed because `quote` *throws*
  rather than returning null).

**Precondition to apply:** Phase 3 repoints `quote` (or those 10 call sites) onto
the app-key price path (`ticker-quotes` / `historical-bars` / `finnhub-quote`).
Once live prices no longer depend on `broker_credentials`, `git mv` this file back
to `supabase/migrations/` and apply it as HUMAN ACTION, then effect-verify with
`SELECT to_regclass('public.broker_credentials');` (must be NULL).
