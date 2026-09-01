# Migration spec: in-house simulator + Alpaca account-linking removal

**Companion to:** `docs/decisions/DR-001-in-house-simulated-trading.md`
**Executor:** Claude Code, branch-per-workstream. No prod-mutating commands — all `supabase db push`, `functions deploy`, `git push`, `secrets set`, and dashboard toggles are HUMAN ACTION.
**Conventions:** Run `git branch --show-current` and `git status --short` before starting or resuming. State main-vs-branch explicitly on every commit report. Verify effects, not status signals.

---

## Phase 0 — Recon (explorer subagent, read-only)

Before writing anything, produce an inventory:

- [ ] Every file in `apps/mobile` and `apps/web` referencing Alpaca account linking: key-entry UI, linked-account state, storage calls, navigation entries, settings screens.
- [ ] Every edge function reading **user** broker credentials (vs Stockpile's own `ALPACA_API_KEY` data pipeline — the pipeline stays).
- [ ] Current schema for: league settings, rosters/positions, symbols, snapshots, transactions. Note actual table/column names — this spec uses placeholder names; **map to reality, do not invent parallel tables.**
- [ ] Where draft validation currently lives (client, edge function, or both).

Output: `docs/migrations/simulator-recon.md`. Do not proceed to Phase 1 until Giorgio reviews it.

> **Phase 0 status: COMPLETE.** Recon findings are authoritative where they contradict this spec's original assumptions. Key recon facts binding on later phases: `drafts` and `symbols` have no in-repo `CREATE TABLE` (created out-of-band); roster reality is two tables, `drafts` (`user_id` TEXT) and `trades` (`user_id` UUID); `leagues.budget_mode`/`leagues.budget_amount` already exist; draft validation is client-only today; Category A edge functions are `save-broker-keys`, `place-order`, `quote`, `sync-alpaca-orders`.

## Phase 0.5 — Prod introspection (HUMAN ACTION, read-only)

Because `drafts` and `symbols` were created out-of-band, their real columns cannot be known from the repo. Before Phase 2 is authored, Giorgio runs read-only queries against prod and pastes results into `simulator-recon.md`:

- [ ] `information_schema.columns` for `drafts`, `symbols`, `trades`, `leagues`, `week_snapshots` (full column list + types + nullability)
- [ ] Vault/secret inventory: what user-broker-key rows exist (names only, not values)
- [ ] Where season format (duration vs weekly) is actually stored
- [ ] Current row counts / refresh recency for `symbols` (sanity for Phase 4 enrichment)

Phase 2 must be authored against these pasted results, not assumptions. `ALTER TABLE ... ADD COLUMN` migrations must first check the column is genuinely absent in the introspection output.

## Phase 1 — Removal scope

Branch: `remove-alpaca-linking`

- [ ] Remove key-entry/linking UI and linked-account state from mobile and web. Note: the "test connection" buttons call `quote` with a probe symbol (no `test-broker-connection` function exists) — remove the buttons, but see the `quote` constraint below.
- [ ] Remove user-credential edge functions: `save-broker-keys`, `place-order`, `sync-alpaca-orders`. (`get-broker-keys` confirmed already absent.)
- [ ] **Do NOT delete `quote` in this phase.** It is currently the only fill-price source; it is removed in Phase 3 only after the app-key `ticker-quotes`/`historical-bars` path is wired as the simulator's fill source. In Phase 1, only strip its user-credential path if separable; otherwise leave intact and record it as Phase 3 debt.
- [ ] `broker_credentials` table (migration `20251217000000`) is the user-key store → drop migration authored here, executed as HUMAN ACTION after Phase 0.5 vault inventory confirms nothing else reads it.
- [ ] README: remove "Link Alpaca paper trading account" from features; move "Live trading integration" to a demand-gated post-launch section; update the What-is-this paragraph (no more "connect a live Alpaca account" for launch).
- [ ] Confirm the market-data pipeline (`refresh_symbols_daily`, quote fetch, snapshot crons) is untouched and still keyed on Stockpile's own `ALPACA_API_KEY`.

Verification: `git grep -il "alpaca" -- apps/` returns only market-data display references (e.g. "prices by Alpaca"), no linking flows. App builds and runs with a fresh account never seeing a linking screen.

## Phase 2 — Schema deltas

Branch: `simulator-schema`. All new tables get RLS from day one (B1 conventions). Deliver as migration files; `db push` is HUMAN ACTION.

**League settings (extend existing table — reconcile, don't parallel):**
- `leagues.budget_mode` + `leagues.budget_amount` already exist. The new `stake_mode` enum (`fixed_notional | price_tiers | budget_cap`) must subsume them: data migration maps existing `budget_mode=true` leagues → `stake_mode='budget_cap'` with `budget_amount` retained as the cap; `budget_mode=false` → commissioner re-choice or default. Deprecate `budget_mode` (keep column until app reads are migrated; drop in a later cleanup migration). Never let both fields be authoritative simultaneously.
- `notional_per_slot` numeric (fixed_notional; default 1000)
- Existing: roster size, rounds, season format — location of season-format storage per Phase 0.5 introspection.

**Draft slots (new, per league):**
- `league_draft_slots`: `league_id`, `slot_index`, `count`, `price_min` nullable, `price_max` nullable, `category_id` nullable. All-null filters = flex slot.
- Guard: validation helper that a slot's filter matches enough draftable symbols for league_size × count (checked at league setup, warn commissioner).

**Categories (new):**
- `categories`: ~10 seeded rows (id, name, display metadata).
- `category_rules`: `gics_industry` → `category_id` (~160 seeded rows; total coverage of vendor taxonomy).
- `symbol_category_overrides`: `symbol`, `category_id`, `justification` text. Cap: ≤3 categories per symbol — enforce with a constraint or trigger, not convention.
- Effective eligibility = overrides if present else rule-table category; unclassified → Misc, flex-only.

**Symbols (extend existing):**
- `gics_sector`, `gics_industry` nullable text (vendor-supplied)
- `is_draftable` boolean default false + the eligibility criteria used to compute it (market-cap floor, price ≥ $1, primary US exchange) — computed in the refresh job, not hardcoded per row.

**Positions/roster (extend `drafts` + `trades` — do NOT create a new roster table):**
- Roster reality is two tables: `drafts` (`user_id` TEXT) and `trades` (`user_id` UUID). This TEXT/UUID mismatch is the documented cast footgun in CLAUDE.md — every join between them must cast explicitly, and no new code may assume the types match. Extending either table must not change the existing `user_id` type in this migration (type unification is out of scope; flag it as a candidate cleanup instead).
- Extend `drafts` (per Phase 0.5 column introspection) with: `slot_id` FK nullable, `quantity` numeric (fractional-capable), `entry_price`, `entry_at` — adding only columns the introspection confirms absent. Fixed notional: `quantity = notional_per_slot / entry_price`. Tiers/cap: `quantity = 1`.
- Mid-week adds: reuse `week_snapshots.entered_mid_week` + `trades` — this is the existing mid-week tracking hook; do not fork it.

**Corporate actions (new or extend):**
- `splits`: `symbol`, `ratio`, `effective_date`, `applied` boolean. Application job multiplies open position quantities on the effective date. `applied` must be set only after verifying the row count of updated positions matches expected — effect-verified, not status-verified.

## Phase 3 — Simulator logic

Branch: `simulator-core`

- [ ] Draft validation (server-side, edge function): pick is legal iff symbol `is_draftable`, not already owned in the league, its category eligibility intersects an unfilled slot, its price fits the slot bracket (tiers) and remaining budget (cap mode). Client mirrors for UX; server is authoritative.
- [ ] Fill-at-draft: record entry price from the current quote pipeline; market-hours handling can be "last available quote" for launch.
- [ ] Add/drop trades: drop frees the symbol league-wide; add validates like a draft pick and fills at current quote.
- [ ] Scoring source change: snapshot jobs read positions from the ledger instead of any account-read path. The scoring modules (`grouping.ts`, `scoring-eligibility.ts`, `plan.ts`, `close.ts`, playoff progression) must not need mode awareness — score input is always (quantity × price) deltas. If a mode branch appears necessary inside scoring, stop and flag; that indicates a modeling error upstream.
- [ ] Duration mode: verify it reduces to one long scoring window over the same snapshot mechanics; extend only if recon shows it isn't already modeled.

Tests: extend the hermetic pure-module suite. Required cases: fixed-notional fractional quantities; tier bracket edges (price exactly at boundary); cap-mode remaining-budget math across a full draft; mid-week add scoring; mid-week split adjustment (weekly + duration); unclassified symbol restricted to flex; ≤3-category cap enforcement.

## Phase 4 — Data enrichment + seed data

Branch: `symbols-enrichment`

- [ ] Extend `refresh_symbols_daily`: pull sector/industry per symbol from the data vendor; populate `gics_*`; compute `is_draftable`; new listings flow through automatically (IPO handling per DR-001). Verify the enrichment step's effect (row counts of newly classified symbols), not its HTTP status — this cron has silently failed before.
- [ ] Seed files in-repo (versioned): `categories.json`, `category_rules.json` (~160 GICS-industry mappings), `symbol_category_overrides.json` (~30–60 entries, each with a one-line justification per the DR-001 criterion). Generate the override draft against the top ~500 draftable names; Giorgio reviews before merge.
- [ ] Commissioner league-setup UI: stake mode picker, notional/budget inputs, slot builder (count + price bracket + category), preset templates (e.g. "3 tech / 2 auto / 1 clothing / 1 flex" style examples), slot-feasibility warnings.
- [ ] Stock search UI: show category labels (and secondary eligibility badges) so drafters aren't surprised by classifications.

Phase 3 notes from recon: the server-side draft validator is **net-new** — today validation is client-only and RLS gates membership, not pick legality; there is no existing server logic to reuse or contradict. Phase 3 also owns wiring the app-key `ticker-quotes`/`historical-bars` path as the simulator's fill-price source, after which `quote` is deleted (see Phase 1 constraint).

## HUMAN ACTION checklist (Giorgio only)

- [ ] Review Phase 0 recon before any code — DONE
- [ ] Phase 0.5 prod introspection: paste `information_schema` output for `drafts`/`symbols`/`trades`/`leagues`/`week_snapshots`, vault inventory, season-format storage location into `simulator-recon.md` — gates Phase 2 authoring
- [ ] Commit DR-001, this spec, and `simulator-recon.md` to **main** before phase branches are cut (recon reported them untracked on `security/claude-security-fixes-20260730`)
- [ ] `supabase db push` per schema migration after diff review
- [ ] `functions deploy` for changed/removed edge functions
- [ ] Drop `broker_credentials` table + user-broker-key vault rows (after Phase 0.5 inventory confirms nothing reads them — `proacl`-grade verification, not absence-of-errors)
- [ ] Review seed override table before merge
- [ ] README/roadmap merge to main; `git push`
- [ ] Confirm data vendor plan exposes sector/industry fields before Phase 4 (else pick fallback source: Finnhub/Polygon ticker details, or static file for launch universe)

## Sequencing

Phase 0.5 (prod introspection) gates Phase 2 authoring. Phase 1 can start immediately after docs land on main — it does not depend on introspection except for the `broker_credentials` drop execution. Phase 3 depends on 2 and owns the `quote` replacement. Phase 4's enrichment depends on 2; its UI depends on 3.

## Out of scope

Broker integration (OAuth/SnapTrade), custom per-league categories, order-book realism, real-time per-user streams. See DR-001 non-goals.
