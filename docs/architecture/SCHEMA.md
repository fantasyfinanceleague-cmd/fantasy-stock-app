# architecture.json — schema (review draft)

Status: **approved 2026-07-25.** Generation is held until `db-snapshot.json` is captured
from prod, so the first map ships with `dbSnapshot.present: true`.

## Approved adjustments (binding on the generator + viewer)

1. **`declared` / `db` / `drift` is a first-class VIEWER surface**, not just a JSON field.
   The viewer gets a dedicated "Migration says X, database says Y" panel listing every
   drift row across all Postgres nodes, visible without selecting a node. Rationale: this
   repo produced two incomplete-audit findings on 2026-07-25 alone — migration
   `20260718000002` claimed a full SECURITY DEFINER inventory it did not have, and
   `MIGRATION_STATUS` called the rotated Alpaca keys harmless. A standing
   claim-vs-reality diff is worth more than the diagram.
2. **9 flows**, quote fan-out folded into one. `snapshot-week-end` is a priority flow:
   `snapshot-week-start` was fixed in `2caf9f8` (all-or-nothing per league-week,
   completeness-based skip) and `snapshot-week-end` presumably still carries both
   defects. The two render side by side so the asymmetry is the headline.
3. **Pre-commit: propose only, do NOT install.** `.githooks/pre-commit` +
   a one-time `git config core.hooksPath .githooks`. (Context: the `--no-verify` habit
   began with a hook that failed earlier in this repo's history. No hook file exists now.)
4. **Redaction refusal message must be specific and actionable** — exact text in §7.
5. **`unverified` renders LOUDLY** — a top-of-page banner with the count and every claim
   listed, not a subtle badge. Same treatment for `dbSnapshot` age. A map that hides its
   own uncertainty is worse than no map.
6. Capture SQL delivered ahead of generation.

---

## 1. Top level

```jsonc
{
  "_comment": "GENERATED — do not hand-edit. Run node scripts/gen-architecture.mjs.",
  "schemaVersion": 1,

  "generated": {
    "commit": "2caf9f8f1c…",           // git rev-parse HEAD
    "commitShort": "2caf9f8",
    "branch": "claude/architecture-map-generator-01ec80",
    "dirty": false,                     // git status --porcelain non-empty at gen time
    "timestamp": "2026-07-25T18:40:11Z",
    "sourceHash": "sha256:9f3c…",       // see §6
    "command": "node scripts/gen-architecture.mjs",
    "generatorVersion": 1
  },

  "dbSnapshot": {
    "present": true,
    "capturedAt": "2026-07-25T17:02:44Z",
    "ageHours": 1.6,
    "ageDays": 0.1,
    "staleAfterDays": 14,               // viewer turns the badge red past this
    "stale": false,
    "hash": "sha256:c41a…",             // feeds sourceHash
    "database": "postgres",
    "counts": { "functions": 17, "tables": 14, "cronJobs": 4 }
  },

  "layers": [                           // column order in the viewer, left → right
    { "id": "trigger", "label": "Triggers",        "order": 0 },
    { "id": "client",  "label": "Client",          "order": 1 },
    { "id": "edge",    "label": "Edge functions",  "order": 2 },
    { "id": "module",  "label": "Pure modules",    "order": 3 },
    { "id": "db",      "label": "Postgres",        "order": 4 },
    { "id": "external","label": "External",        "order": 5 }
  ],

  "nodes": [ /* §2 */ ],
  "edges": [ /* §3 */ ],
  "flows": [ /* §4 */ ],

  "unverified": [ /* §5 — every claim the generator could not prove */ ],

  "stats": { "nodes": 61, "edges": 88, "flows": 6, "unverified": 7 }
}
```

## 2. Node

```jsonc
{
  "id": "fn.process-week-results",
  "label": "process-week-results",
  "sublabel": "verify_jwt=false · apikey guard",
  "layer": "edge",
  "kind": "edge-function",
  "source": { "path": "supabase/functions/process-week-results/index.ts", "line": 814 },

  "facts": {                            // kind-specific, DERIVED FROM FILES
    "localModules": ["grouping.ts", "scoring-eligibility.ts"],
    "envVars": ["SB_SECRET_KEY_CRON", "SB_SECRET_KEY_INTERNAL",
                "ALPACA_API_KEY", "ALPACA_API_SECRET"],
    "authGuard": "apikey header, constant-time, fail-closed",
    "lines": 1481,
    "hasTests": true
  },

  "db": null,                           // populated only for kind pg-function / table (§2.1)
  "declared": null,                     // what the MIGRATIONS claim (§2.1)
  "drift": [],                          // migrations vs live disagreements (§2.1)

  "annotation": null,                   // merged from annotations.json, never generated
  "verified": true
}
```

`kind` is a closed set: `cron-job`, `user-action`, `client-screen`, `client-hook`,
`client-component`, `edge-function`, `edge-module`, `pg-function`, `table`, `external`.

`layer` is derived from `kind`, not hand-assigned — so a new edge function lands in the
right column with zero config.

### 2.1 pg-function and table nodes

The three-block split is the point. `declared` is what the SQL text claims; `db` is what
prod actually has; `drift` is where they disagree. Per CLAUDE.md, `REVOKE … FROM PUBLIC`
does not clear Supabase's default `anon`/`authenticated` grants and
`CREATE OR REPLACE FUNCTION` does not reset privileges — so the migration text is
**not** evidence of who can call a function. Only `proacl` is.

```jsonc
{
  "id": "pg.start_new_league_season",
  "label": "start_new_league_season(uuid)",
  "sublabel": "SECURITY DEFINER · service_role only",
  "layer": "db",
  "kind": "pg-function",
  "source": { "path": "supabase/migrations/20260718000000_lockdown_start_new_league_season.sql", "line": 41 },

  "declared": {                          // parsed from migration text
    "securityDefiner": true,
    "searchPath": "public",
    "definedIn": [
      "supabase/migrations/20260125000000_add_league_seasons.sql",
      "supabase/migrations/20260718000000_lockdown_start_new_league_season.sql"
    ],
    "latestDefinition": "supabase/migrations/20260718000000_lockdown_start_new_league_season.sql"
  },

  "db": {                                // from db-snapshot.json — authoritative
    "securityDefiner": true,
    "searchPath": "public",
    "grants": [                          // parsed out of proacl
      { "role": "service_role", "privileges": ["EXECUTE"] }
    ],
    "grantsRaw": ["postgres=X/postgres", "service_role=X/postgres"],
    "anonCallable": false,
    "authenticatedCallable": false,
    "owner": "postgres"
  },

  "drift": [],
  "annotation": null,
  "verified": true
}
```

Table node:

```jsonc
{
  "id": "tbl.week_snapshots",
  "label": "week_snapshots",
  "layer": "db",
  "kind": "table",
  "source": { "path": "supabase/migrations/20260105000000_add_week_snapshots.sql", "line": 1 },
  "declared": { "rlsEnabled": true, "touchedBy": ["20260105000000_…", "20260712000006_rls_b1_06_week_snapshots.sql"] },
  "db": {
    "rlsEnabled": true,
    "rlsForced": false,
    "policies": [
      { "name": "week_snapshots_select_members", "command": "SELECT", "permissive": true, "roles": ["authenticated"] }
    ]
  },
  "drift": [],
  "annotation": null,
  "verified": true
}
```

`drift` entries look like:

```jsonc
{ "field": "grants", "declared": "revoked from public", "live": "anon=X",
  "severity": "high",
  "note": "REVOKE FROM PUBLIC does not clear Supabase's default anon grant (CLAUDE.md)." }
```

**A high-severity drift entry makes the viewer render that node red.** That turns the map
into a standing audit of the exact class of bug this repo already shipped twice.

## 3. Edge

```jsonc
{
  "id": "e.pwr.read.week_snapshots",
  "from": "fn.process-week-results",
  "to": "tbl.week_snapshots",
  "protocol": "postgrest-select",
  "payload": "user_id, symbol, quantity, week_start_price, week_end_price · WHERE league_id, week_number",
  "callSites": ["supabase/functions/process-week-results/index.ts:918"],
  "annotation": null,
  "verified": true
}
```

`protocol` is a closed set, and it is what the viewer colours edges by:

| protocol | meaning | derived from |
|---|---|---|
| `pg-cron` | scheduled job fires | `cron.job` rows in db-snapshot |
| `pg-net-http` | `net.http_post` out of Postgres | cron job `command` text |
| `https-invoke` | `supabase.functions.invoke('x')` | grep, file:line |
| `postgrest-rpc` | `supabase.rpc('x')` | grep, file:line |
| `postgrest-select` / `-insert` / `-update` / `-upsert` / `-delete` | `.from('t').select()` etc. | grep, file:line |
| `esm-import` | `import … from './mod.ts'` | import scan |
| `vendor-https` | outbound `fetch()` to a known vendor host | URL constants |
| `navigation` | router push between screens | `router.push('/x')` grep |

## 4. Flow

```jsonc
{
  "id": "flow.weekly-scoring",
  "title": "Weekly scoring",
  "trigger": {
    "kind": "cron",
    "detail": "pg_cron job `process-weekly-matchups` — 15 21 * * 5 (Fri 21:15 UTC)",
    "source": "supabase/migrations/20260618000000_migrate_process_week_results_cron_auth.sql:37"
  },
  "nodePath": ["cron.process-weekly-matchups", "fn.process-week-results", "…"],
  "steps": [
    { "n": 1, "edge": "e.cron.pwr", "detail": "…", "files": ["path:line", "…"] }
  ],
  "annotation": null,
  "unverified": ["…"]
}
```

`nodePath` is what the viewer highlights; `steps` is the numbered list below it. Steps
reference edges by id so a step can never cite an edge that does not exist — the
generator asserts this and fails loudly if a hand-authored flow drifts.

## 5. `unverified`

Anything the generator cannot prove from a file or the snapshot goes here rather than
being asserted. Entries carry the reason and how to resolve it:

```jsonc
{ "scope": "flow.weekly-scoring", "claim": "SB_SECRET_KEY_CRON is set on the deployed function",
  "reason": "Function env vars are not in the repo and not in db-snapshot.json.",
  "resolve": "supabase secrets list" }
```

## 6. `sourceHash` and `--check`

Hashed inputs, in this order, SHA-256 over a canonical serialization:

1. Sorted relative paths of every file the generator reads.
2. For each: the **extracted facts**, not the raw bytes — the invoke/rpc/from grep hits
   with line numbers, the import list, the DDL statements matched.
3. Migration filenames (the ordered list — a new migration changes the hash even if its
   content is not parsed).
4. `db-snapshot.json`'s own content hash.

Deliberately **excluded**: commit SHA, timestamp, and `annotations.json`. So editing prose
never makes the map "stale", and committing does not invalidate it.

`--check` recomputes and compares to the stored `sourceHash`:

```
$ node scripts/gen-architecture.mjs --check
architecture.json is STALE (sourceHash mismatch)

  + edge function        supabase/functions/notify-user/
  + invoke call site     apps/mobile/app/(tabs)/league.tsx:88 → 'notify-user'
  - rpc call site        apps/mobile/app/league-settings.tsx:125 → 'start_new_league_season'
  ~ migrations           47 → 48 files

Run: node scripts/gen-architecture.mjs
exit 1
```

Exit 0 and one line when current. `--check` never writes.

## 7. Redaction refusal (adjustment 4)

After reading `db-snapshot.json`, the generator re-scans every `cronJobs[].command` for
key-shaped literals. On a hit it writes nothing and exits 1 with:

```
REFUSING TO BUILD — found a key-shaped literal in cron.job.command.

  job:     snapshot-week-end
  field:   cronJobs[2].command
  matched: sb_secret_… (28 chars, position 214)

A cron job is carrying an inlined key instead of reading it from
vault.decrypted_secrets. Per CLAUDE.md, exposure requires rotation.

DO THIS, IN ORDER:
  1. ROTATE that key now. It is in a DB catalog and may already be in
     this file's git history.
  2. Reschedule the job to read the new key from vault:
       (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '<secret>')
  3. Re-run docs/architecture/db-snapshot.sql and replace db-snapshot.json.
  4. Re-run: node scripts/gen-architecture.mjs

Do NOT delete the match from db-snapshot.json to get past this check —
that hides the exposure without rotating the key.
```

If the match is a false positive (a long quoted identifier rather than a key — see the
note in `db-snapshot.sql`), the escape hatch is `--allow-literal=<jobname>:<field>`,
which records the waiver in `architecture.json` under `unverified` so it stays visible.

---

# Fully-worked flow: weekly scoring

Every line number below was read, not inferred. 18 steps.

**Trigger** — `cron.job` `process-weekly-matchups`, `15 21 * * 5` (Fri 21:15 UTC),
`supabase/migrations/20260618000000_migrate_process_week_results_cron_auth.sql:37`.
Note the name mismatch the migration itself calls out: the job is named
`process-weekly-matchups`, the function is `process-week-results`.

| # | Edge | What happens | Files |
|---|---|---|---|
| 1 | `pg-net-http` cron → fn | `net.http_post` to `/functions/v1/process-week-results` with `apikey` header read from vault secret `cron_apikey`. Body `{}`. | `…20260618000000…sql:41-49` |
| 2 | guard | `isAuthorized` — constant-time compare of the `apikey` header against `SB_SECRET_KEY_CRON`. **Fail-closed**: unset env ⇒ reject all. Runs before body parse and before any DB client. | `index.ts:818` → `85-93`, `72` |
| 3 | `postgrest-upsert` | `updateJobStatus(… 'running')` → `cron_job_status`. | `index.ts:851` → `47` |
| 4 | `postgrest-select` | Pending matchups: `leagues!inner`, `league_type='matchup'`, `team1_gain IS NULL`, `team1_user_id NOT NULL`, `week_end < now()`. Optional `league_id` body filter (simulation harness only). | `index.ts:855-881` |
| 5 | `esm-import` | `groupMatchupsByLeagueWeek` → one batch per **(league_id, week_number)**, sorted `(leagueId, weekNumber ASC)`. Grouping by league alone was the bug; the sort is load-bearing for week advancement (step 16). | `index.ts:899` → `grouping.ts:49` |
| 6 | `postgrest-select` | Per batch: `week_snapshots` for `(league_id, week_number)`, incl. `week_end_price`. Sets `hasSnapshots`, `hasWeekEndPrices`. | `index.ts:918-927` |
| 7 | `esm-import` **GUARD 1&2** | `decideBatchScoring` → `skip:'stale_no_snapshots'` (no snapshots, ended > 72h ago) or `skip:'no_snapshots_week_gt_1'`. Freshness checked **before** week>1 — order is load-bearing for ops labelling. On skip: `continue`, **no matchup write, no standings increment**. | `index.ts:972-1009` → `scoring-eligibility.ts:108` |
| 8 | `postgrest-select` | Mid-week `trades` where `created_at` between `weekStart` and `weekEnd`. | `index.ts:1014-1019` |
| 9 | `postgrest-select` | `drafts` for the league (fallback scorer input). | `index.ts:1041-1044` |
| 10 | `postgrest-select` | `trades` bounded `created_at <= weekEnd` — so a post-week sale doesn't empty holdings and flip a win to an auto-loss. | `index.ts:1054-1061` |
| 11 | `vendor-https` | `fetchPrices` → `https://data.alpaca.markets/v2/stocks/quotes/latest?symbols=…&feed=iex`, headers `APCA-API-KEY-ID` / `APCA-API-SECRET-KEY`. Failures are swallowed → empty price map. | `index.ts:1077` → `131-163` |
| 12 | `esm-import` **GUARD 3a** | `decideUserScorer` per user → `full` \| `legacy` \| `unscoreable` \| `fallback`. `unscoreable` = snapshot-less past week 1; collected into `unscoreableUsers`. | `index.ts:1095` → `scoring-eligibility.ts:146` |
| 13 | `esm-import` **GUARD 3b** | `decideMatchupScoring` — refuse if either participant unscoreable. Byes gate on team1 only (`team2_user_id` null). Refused ⇒ `continue`, `team1_gain` stays NULL, re-run is idempotent via step 4's `IS NULL`. | `index.ts:1144-1162` → `scoring-eligibility.ts:171` |
| 14 | decide | Winner: bye ⇒ auto-win; empty portfolio ⇒ auto-loss; else dollar gain, tiebreak on percent, then playoff seed, else tie. | `index.ts:1166-1251` |
| 15 | `postgrest-update` | `matchups` ← `team1_gain`, `team2_gain` (null on bye), `winner_user_id`, `is_tie`. | `index.ts:1254-1262` |
| 16 | `postgrest-select/update/insert` | `updateUserStandings` → `league_standings` read-then-increment (wins/losses/ties/points_for/points_against). **Not transactional and irreversible** — this is exactly why guards 1–3 refuse rather than fabricate. Skipped for playoff matchups. | `index.ts:1290`, `1299`, `1314`, gate `1330` |
| 17 | `postgrest-select/update` | Re-read `leagues.current_week` per batch; advance only when `weekNumber === currentWeek` and season not completed. Branches: playoff round advance / finals → `completeSeasonFromPlayoffs` / last regular week → `season_status='playoffs'` + `generatePlayoffs` / else `current_week + 1`. | `index.ts:1387-1456`, `generatePlayoffs` `417` |
| 18 | `postgrest-rpc` | `complete_league_season` RPC on season end (both paths). Then `updateJobStatus('success')`. Errors → `updateJobStatus('failed')`. | `index.ts:754`, `798`, `1463`, `1477` |

**Nodes this flow touches (18 edges, 14 nodes):**
`cron.process-weekly-matchups` → `fn.process-week-results` → `mod.grouping` ·
`mod.scoring-eligibility` → `tbl.cron_job_status` · `tbl.matchups` · `tbl.week_snapshots` ·
`tbl.trades` · `tbl.drafts` · `tbl.leagues` · `tbl.league_standings` ·
`pg.complete_league_season` · `ext.alpaca-data`.

**`unverified` for this flow (3):**

1. The live `cron.job` row matches the migration — until `db-snapshot.json` is captured,
   the schedule is *claimed by migration text only*, and this history reschedules by name
   inside exception-swallowing `DO` blocks.
2. `SB_SECRET_KEY_CRON` is actually set on the deployed function. Not in the repo, not in
   the snapshot. Resolve with `supabase secrets list`.
3. `verify_jwt=false` for this function. Asserted by the migration's prose comment, not by
   any file in the repo — there is no `config.toml` entry for it.
