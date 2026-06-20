# Supabase API Key Migration — Phase 2b-2 Report (remaining cron functions)

Spec: `MIGRATION_PHASE_2B2_SPEC.md`. This report is built up sub-phase by
sub-phase. Status at last update:

| Sub-phase | Function | Status |
|-----------|----------|--------|
| A | `process-week-results` | ✅ DONE & MERGED to main (`e92ce06`) |
| B | `snapshot-week-start` | ✅ DONE — gate passed, on branch `phase-2b2bc-cron-functions`, awaiting B+C merge |
| C | `sync-alpaca-orders` | ⏸️ NOT STARTED (held for user review after B) |

Branch strategy: A merged on its own (closed a live public-auth hole); B and C
share a second merge from `phase-2b2bc-cron-functions`.

---

## Sub-phase A — `process-week-results` ✅ DONE & MERGED

- **config.toml:** kept `verify_jwt = false`; comment updated to state the apikey guard now protects it.
- **Function:** 2b-1 apikey guard added as first handler statement (before `req.json()`); internal client `SUPABASE_SERVICE_ROLE_KEY` → `SB_SECRET_KEY_INTERNAL`.
- **Cron migration `20260618000000`:** rescheduled the live job — named **`process-weekly-matchups`** (not the function name; gotcha), schedule `15 21 * * 5` — to send `apikey` from the `cron_apikey` vault secret.
- **Harnesses:** `simulation-test-runner.mjs` and `simulate-season.sh` send the cron apikey for the function call; `service_role` kept only for data-plane seed/teardown (Phase 3). `simulate-season.sh` flags its `/rest/v1` calls break at Phase 4.
- **`api-keys-inventory.md`** (gitignored / local-only): cron key recorded as now also in local `.env`.
- **Security gate:** 6a no-key → 401 `{"error":"Unauthorized"}` (our code, fail-closed confirmed); 6b/6d invalid → gateway 401 `{"message":"Invalid API key"}`; 6c real key → 200 `{"message":"No pending matchups","processed":0}` (scoped to a nonexistent UUID — zero prod mutation); harness 23/23.
- **Merged:** `e92ce06` → main, pushed. Public-auth hole CLOSED.

Commits: `50394b7` (code), `e92ce06` (merge), `a007fd7` (status doc).

---

## Sub-phase B — `snapshot-week-start` ✅ DONE (gate passed, awaiting merge)

- **config.toml:** added `[functions.snapshot-week-start] verify_jwt = false`.
- **Function (`snapshot-week-start/index.ts`):** 2b-1 apikey guard added as first handler statement; internal client `SUPABASE_SERVICE_ROLE_KEY` → `SB_SECRET_KEY_INTERNAL`; the `X-Retry-Attempt` header read preserved. No legacy refs remain.
- **Cron migration `20260618000001`:**
  - Rescheduled the `snapshot-week-start` job (`35 14 * * 1,2`) to send `apikey` from `cron_apikey`.
  - Redefined `schedule_snapshot_retry()` with **BOTH branches on apikey**: the `snapshot-week-end` branch carried forward unchanged from 2b-1 (`20260612000000`), the `snapshot-week-start` branch migrated off legacy `Bearer service_role_key` → `apikey`/`cron_apikey`. `X-Retry-Attempt` preserved on both retry POSTs; the now-unused `service_key` DECLARE removed. No executable legacy auth remains (only explanatory comments mention Bearer/service_role).
- **Applied:** user ran `supabase db push` (first attempt missed the real push; re-run confirmed). Live `cron.job` for `snapshot-week-start` shows `apikey`/`cron_apikey`, no Bearer, schedule `35 14 * * 1,2` intact.
- **Security gate:**
  - 6a no-key → **401** `{"error":"Unauthorized"}` (our code — fail-closed guard running on the deployed `verify_jwt=false` function).
  - 6b/6d invalid key → **401** `{"message":"Invalid API key"}` (gateway).
  - 6c real cron key → **200** (idempotent; current week already snapshotted → zero new writes). *[user-run]*
  - **Retry-path auth verified:** the retry job's scheduled SQL shows `apikey`/`cron_apikey` headers — the auth migration of `schedule_snapshot_retry()` is correct.

**Gate treated as CLOSED:** auth migration proven by live `cron.job` verify + 6a/6b/6c + the apikey header visible in the retry function's SQL.

### ⚠️ Pre-existing bug discovered (NOT introduced by this migration)

While spot-checking the retry path, `schedule_snapshot_retry()` raised:

> `cron.schedule(text, timestamp with time zone, text) does not exist`

`schedule_snapshot_retry()` calls `cron.schedule(name, retry_time::timestamptz, sql)`
for one-time scheduling, but this pg_cron version does not support the
timestamp overload (only the `cron.schedule(name, cron_expression, sql)` form).

- **Pre-existing and unrelated to the key migration.** This is original logic from `20260116000000`; 2b-1 and 2b-2 only changed the auth **header** inside the scheduled command, never the `cron.schedule()` call signature.
- **Auth is fine.** The failure is in scheduling, not auth — the error output showed the retry command's headers using `apikey`/`cron_apikey` as intended.
- **Impact:** the snapshot **retry path is non-functional** on this pg_cron version. Affects **both** `snapshot-week-start` and `snapshot-week-end` retry paths (the main weekly cron jobs are unaffected — they use the supported cron-expression form).
- **Out of scope for 2b-2.** Needs a separate fix (e.g. schedule a near-future cron expression, or use `pg_cron`'s supported one-off mechanism). Do NOT fix here.
- **Stray-job check:** the failed call should not have left a scheduled retry job. User to confirm: `SELECT jobname FROM cron.job WHERE jobname LIKE '%retry%';` (expected: none). *[user-run]*

Commits: `d0c112e` (code).

---

## Sub-phase C — `sync-alpaca-orders` ⏸️ NOT STARTED

Held for user review after B. Per spec: cron-only (confirmed no client invokes it),
flip `verify_jwt` true→false, add guard, swap internal key, preserve
`{"mode":"sync-all"}` cron body; `verify`/`sync` modes become USER-UNREACHABLE
(flag for Phase 5).

---

## Carry-forward / TODO

- **Phase 5:** legacy `service_role_key` vault entry becomes orphaned once Sub-phase C lands (no cron path uses it).
- **Separate task (not a migration phase):** fix `schedule_snapshot_retry()`'s unsupported `cron.schedule()` timestamp overload so the snapshot retry path can actually fire. Pre-existing; affects both snapshot functions.
- **Phase 3:** `simulate-season.sh` `/rest/v1` calls + harness data-plane `createClient` still on `service_role`.
