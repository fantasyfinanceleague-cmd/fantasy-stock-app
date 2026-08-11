# Phase 0 recon — in-house simulator + Alpaca account-linking removal

**Companion to:** `docs/decisions/DR-001-in-house-simulated-trading.md`, `docs/migrations/SIMULATOR_MIGRATION_SPEC.md`
**Status:** Phase 0 (read-only recon) complete; reviewed. **Phase 0.5 (prod introspection) COMPLETE 2026-08-09 — results in the Phase 0.5 section below. Phase 2 authoring is unblocked and must be authored against that section, not the earlier inferred mappings.**
**Session git state:** branch `security/claude-security-fixes-20260730`; working tree clean except untracked `docs/decisions/` and `docs/migrations/SIMULATOR_MIGRATION_SPEC.md` (+ this file).
**Method:** four read-only `explorer` sweeps, then main-session verification of every load-bearing claim via `git grep` / file reads / `db-snapshot.json`. Claims below are marked **[verified]** (I confirmed directly), **[inferred]** (from usage, not a definition), or **[prod-only]** (exists in prod, no repo record).

---

## Executive summary — contradictions with the spec's assumptions

Read these four first; the detailed inventory follows.

1. **`drafts` and `symbols` have NO `CREATE TABLE` in `supabase/migrations/`.** [verified] Both are used everywhere (RLS, realtime, cron, 50+ call sites) but were created out-of-band (dashboard / pre-migration bootstrap). `db-snapshot.json` records their RLS + cron but **not their columns**. → The spec's "**Symbols (extend existing)**" and "**Positions/roster (extend or confirm existing)**" cannot be fully planned from the repo. A prod `information_schema.columns` read is required before Phase 2/4 to know what columns already exist. An `ALTER TABLE ... ADD COLUMN` is still safe to author; the risk is *assuming absence* of a column that's already there.

2. **The spec's one "positions/roster" concept is TWO real tables with mismatched types.** [verified] Initial draft picks live in `drafts` (`user_id` **TEXT**, `quantity` **int-like**); add/drop trades live in `trades` (`user_id` **UUID**, `quantity` **integer**). Any union across them needs `::text` / `::numeric` casts (already a documented footgun in CLAUDE.md). The spec's "reuse the existing mid-week purchase tracking; do not fork it" = `week_snapshots.entered_mid_week` + the `trades` ledger. Do not model roster as a single new table.

3. **League budget columns ALREADY EXIST and overlap the new `budget_cap` stake mode.** [verified] `leagues` has `budget_mode` (`'budget' | 'no-budget'`) and `budget_amount numeric`. The spec's new `stake_mode` enum includes `budget_cap` + a new `budget_cap numeric`. → Map the new mode onto / reconcile with the existing budget columns; do **not** create a parallel budget concept. This is exactly the "do not invent parallel structures" risk.

4. **Draft validation is CLIENT-ONLY today; there is no authoritative server path.** [verified] RLS on `drafts` gates *league membership only*, not pick legality. The spec's Phase 3 server-side validator is net-new (correctly identified as such) — but note that means **no existing server logic to reuse or contradict**, and the client checks (uniqueness, budget, turn) are advisory only.

**Corrections to the recon sweeps themselves** (verified against source):
- **`test-broker-connection` does NOT exist** as an edge function or client call. The "test connection" buttons invoke **`quote`** with a probe symbol (`profile.tsx:191`, AAPL). An earlier sweep misnamed it.
- **`broker_credentials` IS defined in-repo** (`20251217000000_create_broker_credentials.sql`) — one sweep missed it. This table (not a vault row) is the primary user-broker-key store to drop.
- **`get-broker-keys` confirmed absent** (already retired) — verified against the function-dir listing, not memory.

---

## Item 1 — apps referencing Alpaca ACCOUNT LINKING (to remove)

Scope: `apps/mobile/` + `apps/web/`. Classification: **LINK** = user-key entry/linked-account flow (remove); **DISPLAY** = data attribution / sourcing (stays).

### Mobile
| File | Lines | Kind | Notes |
|---|---|---|---|
| `apps/mobile/app/(tabs)/profile.tsx` | 35–43 (state), 72–214 (handlers), 518–638 (UI), 853–951 (styles) | LINK | Alpaca section: key-id/secret inputs, `handleAlpacaSave` → `functions.invoke('save-broker-keys')`, `handleAlpacaUnlink` → deletes `broker_credentials`, `handleTestConnection` → `functions.invoke('quote')` (line 191, **not** a `test-broker-connection` fn). `checkAlpacaStatus` reads `broker_credentials`. |
| `apps/mobile/components/TradeModal.tsx` | 72, 80–96, 355/363/371, 403–422 | LINK | `hasAlpacaLinked` state; `checkAlpacaLink()` queries `broker_credentials`; "Alpaca Account Required" gate + credential error strings. |
| `apps/mobile/app/(tabs)/_layout.tsx` | 90–96 | KEEP | Profile tab itself stays (hosts username/password); only the Alpaca *section* inside profile is removed. |

### Web
| File | Lines | Kind | Notes |
|---|---|---|---|
| `apps/web/src/pages/Profile.jsx` | 40–50 (state), 79–217 (handlers), 605–800 (UI incl. "How to get your API keys") | LINK | Mirror of mobile: `save-broker-keys`, unlink, `testConnection` → `quote`, `checkAlpacaLink` → `broker_credentials`. |
| `apps/web/src/components/TradeModal.jsx` | 35, 44–59, 367–394 | LINK | `hasAlpacaLinked` gate; queries `broker_credentials`; redirects to `/profile` when unlinked. |
| `apps/web/src/pages/DraftPage.jsx` | 169–170, 323–334, 1300–1323 | LINK | `membersWithoutAlpaca` state + `broker_credentials` query + "Alpaca Required" pre-draft warning block. |
| `apps/web/src/components/OnboardingModal.jsx` | 85–93 | LINK | Onboarding step 1 "Connect Your Broker" → `/profile`. Must be removed/replaced, not just hidden. |
| `apps/web/src/components/ProgressChecklist.jsx` | 211–238 (alpaca item) | LINK | `hasAlpaca` setup-progress item → `/profile`. |
| `apps/web/src/pages/Dashboard.jsx` | ~560 | LINK | Passes `hasAlpaca` into `useSetupProgress`. |
| `apps/web/src/utils/errorMessages.js` | 31–32 | LINK | `credentials_invalid` / `no_credentials` user-facing strings. |

### DISPLAY-only (stays — do NOT remove)
- `apps/web/src/pages/DraftPage.jsx:612–619, 690` — "Quote lookup (Alpaca → Finnhub fallback)" comments + `alpaca_order_id` field on trade records (data plumbing, not linking).
- `apps/web/src/Ticker.jsx:35` — comment referencing `alpaca_error` payload shape.
- Docs/archival (`apps/web/docs/*`, `apps/mobile/ARCHITECTURE.md`, `apps/web/docs/SECURITY.md` lines documenting server-side `ALPACA_API_KEY`) — reference material.

**Client-side coupling to flag:** several client sites query the `broker_credentials` table **directly** (`profile.tsx:72`, `Profile.jsx:79`, both `TradeModal`s, `DraftPage.jsx:323`). When the table is dropped (Phase 1/2, HUMAN ACTION), every direct read must be removed or they will error. `alpaca_order_id` columns on `trades`/`drafts` become vestigial once user-account order execution is gone — decide keep-nullable vs drop in Phase 2.

---

## Item 2 — edge functions & user broker credentials

Ground truth: 16 function dirs. **No `get-broker-keys`, no `test-broker-connection`.** [verified via `ls supabase/functions/`]

### Category A — read/store USER broker credentials → REMOVE
| Function | Evidence | Role |
|---|---|---|
| `save-broker-keys` | validates against Alpaca paper API, encrypts + writes user key/secret to `broker_credentials` keyed on `user_id` | the write path for user keys |
| `place-order` | `getUserCredentials()` decrypts per-user creds, POSTs to `paper-api.alpaca.markets` with the user's key | user-account order execution |
| `quote` | requires user auth, `getUserCredentials()` → live quote via user's key; errors `no_credentials`/`credentials_invalid` | backs the "test connection" buttons; user-cred live quotes |
| `sync-alpaca-orders` | `'sync-all'` loops **every** `broker_credentials` row and syncs each user's Alpaca account; `'sync'`/`'verify'` use caller's creds | cron + per-user; still user-cred despite being scheduled |

### Category B — Stockpile's own app-wide `ALPACA_API_KEY` (market DATA) → STAYS
`ticker-quotes`, `symbols-search`, `historical-bars`, `snapshot-week-start`, `snapshot-week-end`, `process-week-results` — all read `Deno.env.get('ALPACA_API_KEY')` / `ALPACA_API_SECRET` (single app key), no per-user credentials. This is the DR-001 "Alpaca stays as server-side data vendor" pipeline.

### Neither (unrelated) — untouched
`send-notification`, `refresh-symbols`, `preview-league`, `join-league`, `symbol-name`, `finnhub-quote`.

**Credential-custody surface to retire (HUMAN ACTION per spec):**
- Table `broker_credentials` — defined `supabase/migrations/20251217000000_create_broker_credentials.sql:2` (RLS enabled `:17`). Holds encrypted user key/secret.
- Any **vault** rows for user broker keys — needs a prod check; distinct from Stockpile's own `ALPACA_API_KEY` env/vault entry, which **stays**. Verify with `proacl`/vault introspection before dropping (spec's "not absence-of-errors" bar).
- **Design flag for Phase 3:** removing `quote` (user-cred live quotes) leaves the simulator needing a fill-price source. The app-key path (`ticker-quotes` / `historical-bars`) is the natural replacement — spec Phase 3 "fill-at-draft from the current quote pipeline" points here. Not a Phase 0 action; flagged so `quote` isn't deleted without its replacement wired.

---

## Item 3 — schema mapping (spec placeholder → real)

| Spec placeholder concept | Real table.column(s) | Type(s) | Defined at | Confidence |
|---|---|---|---|---|
| **League settings** | `leagues`: `num_participants`, `num_rounds` (default 6), `budget_mode` (`'budget'\|'no-budget'`), `budget_amount`, `duration_days`, `draft_status` | int / text / numeric | `20250818225829_create_leagues.sql`; `..._add_league_duration`; `20251205000000_add_draft_status.sql` | [verified] |
| — new `stake_mode` / `notional_per_slot` / `budget_cap` | **none exist** — but `budget_mode`+`budget_amount` overlap `budget_cap` mode | — | — | [verified] see flag #3 |
| — season format (weekly \| duration) | represented via `duration_days` and (separately) `league_seasons` table for weekly matchups; **no single `season_format` enum confirmed in repo** | — | `league_seasons` appears in RLS migrations | [inferred] confirm storage of weekly-vs-duration in prod |
| **Rosters / positions (draft source)** | `drafts`: `league_id`, `user_id` **TEXT**, `symbol`, `entry_price`, `quantity`, `round`, `pick_number`, `alpaca_order_id?`, `created_at` | uuid/text/numeric/int | **NO `CREATE TABLE` in repo** — RLS at `20251205110000_enable_drafts_rls.sql` | **[prod-only]** columns inferred from usage |
| **Rosters / positions (trades source)** | `trades`: `league_id`, `user_id` **UUID** → `auth.users(id)`, `symbol`, `action` (`'buy'\|'sell'`), `quantity` **integer**, `price` numeric(10,2), `total_value`, `alpaca_order_id?`, `created_at` | uuid/text/int/numeric | `20250118000000_create_trades.sql:2`; `..._add_alpaca_order_id_to_trades` | [verified] |
| **Symbols** | `symbols`: `symbol`, `name` (only these confirmed). **No** `gics_*` / `sector` / `industry` / `is_draftable`. | text | **NO `CREATE TABLE` in repo**; upserted by `refresh-symbols` | **[prod-only]** columns inferred; sector/draftable absence [verified against snapshot] |
| **Snapshots** | `week_snapshots`: `league_id`, `user_id` **TEXT**, `week_number`, `symbol`, `quantity` numeric(12,6), `week_start_price` numeric(12,4) **NOT NULL**, `week_end_price` numeric(12,4) nullable, `entered_mid_week` bool NOT NULL default false, `created_at`; unique `(league_id,user_id,week_number,symbol)` | mixed | `20260105000000_add_week_snapshots.sql:7`; `20260116000000_matchup_scoring_redesign.sql:18`; `20260727100000_week_snapshots_entered_mid_week.sql:44` | [verified] — matches spec assumptions cleanly |
| **Transactions** | `trades` **only** — no generic ledger. Discriminator is `action` (`'buy'\|'sell'`), **not** a `side` column. | — | `20250118000000_create_trades.sql` | [verified] |
| **Draft slots** (`league_draft_slots`) | **NO EQUIVALENT** — net-new | — | — | [verified] |
| **Categories** (`categories`, `category_rules`, `symbol_category_overrides`) | **NO EQUIVALENT** — net-new | — | — | [verified] |
| **Splits / corporate actions** | **NO EQUIVALENT** — net-new | — | — | [verified] |

Note: `league_seasons` exists (RLS migrations) and is not named in the spec; relevant to how weekly-vs-duration season format is stored — confirm before Phase 2 league-settings work.

---

## Item 4 — where draft validation lives

**CLIENT-ONLY. No authoritative server-side draft-legality path exists today.** [verified]

| Rule | Enforcement | Location |
|---|---|---|
| Symbol not already picked in league | client only | `apps/mobile/app/(tabs)/draft.tsx:182`; `apps/web/src/pages/DraftPage.jsx:805` |
| Price within budget (budget mode) | client only | `draft.tsx:207`; `DraftPage.jsx:832–890` |
| User's turn | client only | `draft.tsx:225`; `DraftPage.jsx:649` |
| No duplicate `pick_number` (race safety) | client check + DB partial unique index | `DraftPage.jsx:909`; `20260108000000_add_unique_pick_constraint.sql:28` |
| User is a league member | **server (RLS)** | `20251205110000_enable_drafts_rls.sql:22–47` |

Picks are written by **direct client `.from('drafts').insert()`** (mobile `draft.tsx:235`, web `DraftPage.jsx:693`) — RLS validates membership, **not** legality. `place-order` records trades but does not validate draft legality. **Not enforced anywhere:** `is_draftable`, slot/category eligibility, tier brackets, per-tier/cap remaining budget, symbol-per-league uniqueness (server). All are Phase 3 net-new — no existing server logic to reuse or contradict.

---

## Open questions requiring a prod read (before Phase 2/4, not Phase 0)

> **Update 2026-08-09 — dev draft-pick test (anon-key client + authenticated user, RLS applied):** a real `drafts` insert via the current draft flow returned the table's full column set via `select('*')`. **`drafts` ALREADY HAS `entry_price` and `quantity` columns** (both written by the flow today), alongside `id`, `league_id`, `user_id`, `symbol`, `round`, `pick_number`, `draft_date`, `alpaca_order_id` (NULL), `status`, `current_pick`, `current_round`, `is_current_pick`, `started_at`, `completed_at`, `created_at`. **Phase 2 (spec line 71) plans to extend `drafts` with `slot_id`, `quantity`, `entry_price`, `entry_at` — but at least TWO of those (`quantity`, `entry_price`) ALREADY EXIST**; `slot_id` and `entry_at` are the likely genuine additions (note `drafts` already has `draft_date`, which may already serve `entry_at`'s role). Do NOT blindly `ADD COLUMN entry_price`/`quantity`. This is column NAMES + example values only (no types/nullability/defaults) — reconcile against the formal `information_schema` paste before authoring any `ALTER TABLE ... ADD COLUMN`.

1. **`information_schema.columns` for `drafts` and `symbols`** — ✅ ANSWERED in Phase 0.5 below.
2. **Vault inventory** — ✅ ANSWERED in Phase 0.5 below: vault contains NO user broker keys.
3. **Season-format storage** — ✅ ANSWERED in Phase 0.5 below: `leagues.league_type` text, default `'duration'`.
4. **Refresh a `db-snapshot.json`** after the above — ⏳ STILL OPEN (housekeeping; does not gate Phase 2 now that real columns are recorded here).

---

## Phase 0.5 — prod introspection results (HUMAN ACTION, run 2026-08-09)

Read-only queries run by Giorgio in the Supabase SQL editor. **This section is the authoritative ground truth for Phase 2 authoring.** Where it contradicts Item 3's inferred mappings, this section wins.

### information_schema.columns (full, verbatim)

**`drafts` — 17 columns.** The out-of-band table, now fully known:

| column | type | nullable | default |
|---|---|---|---|
| id | uuid | NO | uuid_generate_v4() |
| league_id | uuid | **YES** | — |
| user_id | text | NO | — |
| symbol | text | NO | — |
| entry_price | numeric | NO | — |
| quantity | **integer** | NO | — |
| round | integer | NO | — |
| pick_number | integer | NO | — |
| draft_date | timestamp **without** time zone | NO | now() |
| alpaca_order_id | text | YES | — |
| status | text | NO | 'pending' |
| current_round | integer | NO | 1 |
| current_pick | integer | NO | 1 |
| is_current_pick | boolean | NO | false |
| started_at | timestamptz | YES | — |
| completed_at | timestamptz | YES | — |
| created_at | timestamptz | NO | now() |

**`leagues` — 21 columns:**

| column | type | nullable | default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO | — |
| commissioner_id | **text** | NO | — |
| invite_code | text | NO | — |
| draft_date | timestamptz | YES | — |
| salary_cap_limit | numeric | YES | — |
| num_participants | integer | NO | — |
| num_rounds | integer | NO | 6 |
| budget_mode | text | NO | 'budget' |
| budget_amount | numeric | NO | **100** |
| draft_status | text | NO | 'not_started' |
| duration_days | integer | NO | 30 |
| league_start_date / league_end_date | timestamptz | YES | — |
| league_type | text | NO | **'duration'** |
| num_weeks | integer | YES | — |
| current_week | integer | YES | 1 |
| playoff_teams | integer | YES | 4 |
| current_season_id | uuid | YES | — |
| season_status | text | YES | 'active' |
| created_at | timestamptz | NO | now() |

**`symbols` — only 6 columns:** `symbol` text NOT NULL, `name` text NOT NULL, `exchange` text NULL, `is_etf` bool NULL default false, `active` bool NULL default true, `updated_at` timestamptz NULL default now(). **No price, no market cap, no sector/industry, no is_draftable.**

**`trades` — 10 columns:** `id` uuid, `league_id` uuid NOT NULL, `user_id` **uuid** NOT NULL, `symbol` text NOT NULL, `action` text NOT NULL, `quantity` **integer** NOT NULL, `price` numeric NOT NULL, `total_value` numeric NOT NULL, `alpaca_order_id` text NULL, `created_at` timestamptz NULL default now().

**`week_snapshots` — 10 columns:** `id` uuid, `league_id` uuid NOT NULL, `user_id` **text** NOT NULL, `week_number` int NOT NULL, `symbol` text NOT NULL, `quantity` **numeric** NOT NULL, `week_start_price` numeric NOT NULL, `week_end_price` numeric NULL, `entered_mid_week` bool NOT NULL default false, `created_at` timestamptz NOT NULL. Matches Item 3 / spec assumptions exactly.

### Vault inventory (names only)

| name | description | created |
|---|---|---|
| `service_role_key` | — | 2026-01-06 |
| `cron_apikey` | sb_secret used by pg_cron to auth edge-function invocations | 2026-06-12 |

**Finding: the vault contains NO user broker keys.** `broker_credentials` (the table) was the sole user-key store; Stockpile's own `ALPACA_API_KEY` lives as an edge-function secret (Deno.env), not a vault row. → The spec's "drop user-broker-key vault rows" HUMAN ACTION resolves to **nothing to drop**; both existing vault rows are infrastructure and MUST stay. The `broker_credentials` drop is now gated only on the `quote` call-site grep (Phase 1 report, Gap 2).

### symbols row count / freshness

`count = 13,458`, `max(updated_at) = 2026-05-01`. **⚠ ~3 months stale as of 2026-08-09.** Either `refresh-symbols` / `refresh_symbols_daily` has been silently failing since early May, or the refresh upserts without touching `updated_at`. Matches the documented silent-cron-failure pattern — **verify before Phase 4 builds on this cron** (check `cron.job_run_details` for the job, and whether the function's upsert sets `updated_at`). Flagged as a Phase 4 pre-condition.

### Consequences binding on Phase 2 (authoritative delta list)

1. **`drafts.quantity` is INTEGER — fixed-notional mode requires fractional quantities.** Phase 2 must `ALTER COLUMN quantity TYPE numeric` (safe widening) rather than add a column. Same for `trades.quantity` (integer). `week_snapshots.quantity` is already numeric — no change.
2. **Do NOT add `entry_price`/`quantity` to `drafts`** — they exist (NOT NULL, no defaults). Genuine additions: `slot_id` (uuid FK, nullable) only. `entry_at` is served by existing `draft_date` — but note it is `timestamp WITHOUT time zone` while every other timestamp is `timestamptz`; decide: live with it or migrate the column type. Do not add a parallel `entry_at`.
3. **`drafts.league_id` is NULLABLE** — surprising for a league-scoped table. Any Phase 3 server validator must treat NULL league_id as invalid; consider backfill + `SET NOT NULL` as a cleanup migration (verify no NULL rows first).
4. **`drafts` mixes two concerns**: pick rows AND draft-session state (`status`, `current_round`, `current_pick`, `is_current_pick`, `started_at`, `completed_at` — session columns denormalized per-row). Phase 2/3 must not assume one row = one pick semantics for those columns; map how the app actually uses them before touching.
5. **`leagues` has THREE budget-ish fields**: `budget_mode` text ('budget'|'no-budget'), `budget_amount` numeric (default **100** — note: dollars, low), and `salary_cap_limit` numeric nullable (likely legacy — verify usage with git grep; deprecate if dead). The spec's `stake_mode` reconciliation: extend/replace `budget_mode` values → `fixed_notional | price_tiers | budget_cap` (data migration maps 'budget'→'budget_cap', 'no-budget'→commissioner re-choice), `budget_amount` becomes the cap, add `notional_per_slot`. Never two authoritative fields.
6. **Season format = `leagues.league_type`** ('duration' default; weekly presumably 'weekly' — confirm the exact value with one `select distinct league_type from leagues`). `duration_days`, `num_weeks`, `current_week`, `playoff_teams` are the per-format parameters. `league_seasons` (multi-season) rides on top via `current_season_id`/`season_status`.
7. **`symbols` needs more than gics columns**: `is_draftable` computation (market-cap floor, price ≥ $1, exchange) requires price/market-cap data the table doesn't hold. Phase 4 must either add `last_price`/`market_cap` columns fed by the refresh job, or compute eligibility from the quotes path at refresh time. Also `exchange` is nullable — the exchange-based eligibility test needs null handling.
8. **user_id type map (final):** `drafts` TEXT, `week_snapshots` TEXT, `trades` UUID, `leagues.commissioner_id` TEXT. The UUID island is `trades`. All cross-table joins cast explicitly; no type unification in Phase 2.

---

## Phase 0 checklist status

- [x] apps referencing Alpaca account linking (key entry, linked state, storage, nav, settings) — Item 1
- [x] edge functions reading user broker creds vs the app-key data pipeline — Item 2
- [x] current schema for league settings / rosters-positions / symbols / snapshots / transactions, placeholders mapped to reality — Item 3
- [x] where draft validation lives (client vs server) — Item 4
- [x] **Phase 0.5**: prod `information_schema` for the five tables, vault inventory, season-format storage — see Phase 0.5 section (2026-08-09)

**Phase 0 + 0.5 complete. Phase 2 authoring is unblocked — author strictly against the Phase 0.5 section.** Remaining gates: `quote` call-site grep before applying the `broker_credentials` drop migration; symbols-staleness verification before Phase 4 builds on the refresh cron.
