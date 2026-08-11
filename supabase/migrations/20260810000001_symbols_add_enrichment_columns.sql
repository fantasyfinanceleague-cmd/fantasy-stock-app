-- In-house simulator (DR-001 / SIMULATOR_MIGRATION_SPEC Phase 2)
-- Binding consequence #7 (simulator-recon.md, Phase 0.5).
--
-- WHAT: add the columns the draftable-universe + category machinery reads off
--   `symbols`. COLUMNS ONLY — no enrichment/backfill job here (that is Phase 4;
--   see spec line 67 and the Phase 4 refresh-job task). Every column defaults to
--   a benign value so unenriched rows stay coherent until Phase 4 populates them.
--
--   gics_sector    text        null   -- vendor GICS sector    (category layer 1)
--   gics_industry  text        null   -- vendor GICS industry  (category_rules key)
--   is_draftable   boolean NOT NULL default false
--                                     -- computed in the Phase 4 refresh job from
--                                        market-cap floor, price >= $1, primary US
--                                        exchange. Default false = nothing is
--                                        draftable until the job classifies it,
--                                        which also keeps IPOs flex-only (DR-001).
--   last_price     numeric     null   -- fed by refresh job; input to is_draftable
--   market_cap     numeric     null   -- fed by refresh job; input to is_draftable
--
-- WHY these five: symbols currently holds only symbol/name/exchange/is_etf/
--   active/updated_at (Phase 0.5). is_draftable cannot be computed without price
--   and market-cap data the table did not hold, so last_price/market_cap are
--   added alongside the GICS columns (binding consequence #7). `exchange`
--   already exists and is nullable — the exchange-eligibility test must handle
--   NULL; that logic lives in the Phase 4 job, not this schema.
--
-- SAFETY: all five columns are confirmed ABSENT in Phase 0.5. `if not exists`
--   guards each ADD so a re-run is a no-op.
--
-- HUMAN ACTION: `supabase db push` is Giorgio's.

alter table symbols add column if not exists gics_sector   text;
alter table symbols add column if not exists gics_industry text;
alter table symbols add column if not exists is_draftable  boolean not null default false;
alter table symbols add column if not exists last_price    numeric;
alter table symbols add column if not exists market_cap    numeric;

comment on column symbols.is_draftable is
  'Computed by the Phase 4 refresh job (market-cap floor / price >= $1 / primary US exchange). Default false: not draftable until classified — keeps unenriched rows and IPOs flex-only.';
