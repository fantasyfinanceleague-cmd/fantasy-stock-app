# Supabase API Key Migration — Phase 2b-2: Remaining 3 Cron Functions

## Purpose

Migrate the last 3 cron-invoked edge functions off legacy JWT auth onto the new
apikey-header pattern proven in Phase 2b-1:

- `process-week-results` — **do first** (currently `verify_jwt=false` with NO apikey check → publicly unauthenticated, money/standings-adjacent)
- `snapshot-week-start`
- `sync-alpaca-orders`

After this phase, **no cron job and no edge function depends on the legacy
`service_role` key.** (The legacy `service_role_key` vault entry becomes orphaned
— flagged for Phase 5, not removed here.)

This phase reuses the 2b-1 pattern verbatim. It does **not** re-derive it. See:
- Security-critical apikey requirements: `MIGRATION_PHASE_2B1_SNAPSHOT_WEEK_END.md` §"Security-critical requirements" (constant-time, fail-closed, no info leak, validation-first)
- Reference implementation of the guard + cron migration: `MIGRATION_PHASE_2B1_REPORT.md` §4, §6

Whenever this spec says **"apply the 2b-1 apikey pattern,"** it means: copy the
`constantTimeEqual` / `isAuthorized` / `unauthorized` helpers and the
validation-first handler guard from the 2b-1 `snapshot-week-end` implementation,
validating the incoming `apikey` header against `SB_SECRET_KEY_CRON`.

---

## Already in place (no setup needed)

From Phases 1 / 2b-1, all of these already exist — do **not** recreate them:
- Vault entry `cron_apikey` (holds the `cron` sb_secret value)
- Function secrets `SB_SECRET_KEY_CRON` and `SB_SECRET_KEY_INTERNAL`
- The proven guard implementation in `snapshot-week-end/index.ts` to copy from

The **one** new setup item this phase introduces is widening the cron key into
the **local `.env`** so the test harness can authenticate (see Task A4).

---

## Critical constraints

- **Do NOT modify** `snapshot-week-end` (done in 2b-1) or any client-invoked function (done in 2a).
- **Do NOT** remove the legacy `service_role_key` vault entry (orphaned after this phase → Phase 5).
- **Do NOT** disable legacy keys in the dashboard (Phase 4).
- **Do NOT** migrate the PostgREST / data-plane calls in `simulate-season.sh` (the `apikey:`/`Authorization:` headers on `/rest/v1/...` requests) — those are Phase 3 (client/script data-plane migration). This phase touches **only** the edge-function invocation headers.
- **Branch strategy: A merges to main on its own, before B/C start.** Sub-phase A closes a live publicly-unauthenticated hole on a money-adjacent function and is independently complete, so it ships first:
  - Branch `phase-2b2a-process-week-results` → Sub-phase A → gate A6 → **STOP for user review** → merge to main.
  - Then branch `phase-2b2bc-cron-functions` off updated main → Sub-phases B + C → second merge.
  - Commit with `--no-verify` (pre-commit hook is known-broken).
- **Sub-phase A must be fully deployed, pass its security gate (Task A6), and be merged (after user review) before B or C start.** If A's gate fails, STOP and report — do not proceed.
- Sensitive values (real cron key for 6c, vault SQL) are run by the **user**, never passed through Claude Code.

---

## Gotchas specific to this phase (the value of the 2b-1 "enumerate every path" lesson)

1. **`process-week-results`'s live cron job is named `process-weekly-matchups`, NOT `process-week-results`** (schedule `15 21 * * 5`, defined in `20260116000000_matchup_scoring_redesign.sql:118`). Unschedule/reschedule that **exact** job name. Keep the name as-is (do not rename — avoids churn and matches the 2b-1 "match exactly" rule).
2. **`process-week-results` has THREE invocation paths**, not one:
   - cron job `process-weekly-matchups` (legacy Bearer service_role)
   - `scripts/simulation-test-runner.mjs` (`Authorization: Bearer <service_role>`, optional `{league_id}` body)
   - `scripts/simulate-season.sh` (`Authorization: Bearer <service_role>`, no body → processes ALL leagues, 5× loop)

   Both scripts break the instant the guard lands. Both must switch their **function-call** header to `apikey: <cron key>`.
3. **The harness must send the CRON key, not the local-scripts key.** The guard validates against `SB_SECRET_KEY_CRON`; `SB_SECRET_KEY_LOCAL_SCRIPTS` would 401. This widens the cron key's footprint into local `.env` (previously "function secret only") — must be recorded in `docs/api-keys-inventory.md`.
4. **`snapshot-week-start` has a second path:** `schedule_snapshot_retry()`'s `snapshot-week-start` branch is still on legacy Bearer (deliberately left in the 2b-1 migration). Its `snapshot-week-end` branch was already migrated to apikey in 2b-1. `CREATE OR REPLACE FUNCTION` replaces the whole body, so the new definition must carry **both** branches on apikey. Use the 2b-1 migration's version (`20260612000000`) as the base and migrate only the remaining branch. Preserve the `X-Retry-Attempt` header on the retry POST.
5. **`sync-alpaca-orders` is a dormant hybrid.** Code has user-authed `verify`/`sync` modes plus a cron-only `sync-all` mode. Exhaustive grep (apps/mobile, apps/web, scripts — literal name, mode strings, dynamic `invoke(var)`, raw `fetch /functions/v1/`) found **zero** callers of `verify`/`sync`. Web/mobile ship from this repo (Vercel/EAS), so dead-in-repo = dead-in-prod. Treat it as **cron-only**. After the guard lands, `verify`/`sync` become **USER-UNREACHABLE** (apikey calls carry no user JWT → `not_authenticated`) — this is a behavior change to record for Phase 5, not just a refactor. Preserve the `{"mode":"sync-all"}` body in the cron SQL (without it, mode defaults to `sync` → `not_authenticated`).

---

## Tasks

### 0. Branch

```bash
git checkout -b phase-2b2a-process-week-results
```
(Sub-phases B + C use a second branch off updated main after A merges — see Branch strategy.)

---

## SUB-PHASE A — `process-week-results` (FIRST, hard-gated)

### A1. config.toml
Block already exists with `verify_jwt = false`. Keep it. Update the stale comment
(`# Allow cron to call without auth`) to state that the function's own
apikey-header validation (`SB_SECRET_KEY_CRON`, constant-time, fail-closed) is now
the auth guard — mirroring the wording on the `snapshot-week-end` block.

### A2. `supabase/functions/process-week-results/index.ts`
- **Apply the 2b-1 apikey pattern.** Insert the guard as the **first** statement in the `Deno.serve` handler — critically, **before** the existing `await req.json()` body parse (used for optional `league_id` scoping). Reuse the existing `json()` helper (defined at top of file) for the 401 body `{ error: 'Unauthorized' }`.
- Swap the internal DB client: `SERVICE_ROLE = env('SUPABASE_SERVICE_ROLE_KEY')` → `SECRET_KEY = env('SB_SECRET_KEY_INTERNAL')`; update the `createClient(...)` call and the missing-config guard (the `if (!SUPABASE_URL || !SERVICE_ROLE)` check) to reference the new var.
- Leave all business logic unchanged.

### A3. Cron migration — `supabase/migrations/20260618000000_migrate_process_week_results_cron_auth.sql`
Unschedule + reschedule the **`process-weekly-matchups`** job (exact existing name),
schedule `15 21 * * 5`, body `{}`, header `apikey` sourced from the `cron_apikey`
vault secret. Follow the 2b-1 migration's unschedule/reschedule shape
(`MIGRATION_PHASE_2B1_REPORT.md` §6). Do **not** apply yet (Task A5).

### A4. Test-harness migration + key location
- `scripts/simulation-test-runner.mjs`: change the `process-week-results` POST header (the raw `fetch`, ~line 438) from `Authorization: Bearer <serviceRoleKey>` to `apikey: <cron key>`, reading the value from a new env var **`SB_SECRET_KEY_CRON`** (`process.env.SB_SECRET_KEY_CRON`). The runner **also** keeps using `SUPABASE_SERVICE_ROLE_KEY` for its own `createClient(...)` seed/teardown (data plane — Phase 3), so the startup check must now require **both** env vars; update the usage message accordingly. Never hardcode either value.
- `scripts/simulate-season.sh`: same swap for the **function** call only (the `$FUNCTION_URL` POST, currently `Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY`) → `apikey: $SB_SECRET_KEY_CRON`. **Leave the `/rest/v1/...` PostgREST calls on `SUPABASE_SERVICE_ROLE_KEY`** (Phase 3 — out of scope). Add a comment in the script stating explicitly: the `/rest/v1` data-plane calls still use the legacy `service_role` key and **will break once legacy keys are disabled in Phase 4**, and stay broken until Phase 3 migrates them — so **this script must not be relied on in the window between Phase 4 and Phase 3 completion.**
- **User action (not Claude Code):** add `SB_SECRET_KEY_CRON=<cron secret value>` to the local repo-root `.env`.
- `docs/api-keys-inventory.md`: update the `cron` row (row currently reads "function secret only — not in local .env") and the "Local `.env`" row to record that the cron key now also lives in local `.env`, used by the simulation harness. Note this is a deliberate widening for test infra.

### A5. Deploy + apply (user-gated for prod cron)
- **Deploy and apply the cron migration in the same working session, back-to-back — do not leave a gap.** Once the guarded function is deployed, the still-legacy cron job sends `Authorization: Bearer <service_role>` with no `apikey`, so it would 401 if it fired before the migration lands. The window is tiny (and the job only fires on its weekly schedule), but close it deliberately rather than leaving it open across sessions.
  1. Deploy: `supabase functions deploy process-week-results --no-verify-jwt`.
  2. Immediately apply cron migration: `supabase db push` (dry-run first; confirm only the new migration is pending — STOP if any unexpected migration appears). User runs / approves, since it mutates production cron.
- Verify live job: `SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'process-weekly-matchups';` — `command` must show `apikey` + `cron_apikey`, no `Authorization`/`Bearer`/`service_role_key`.

### A6. 🚦 SECURITY GATE (must fully pass before Sub-phase B or C)
1. **6a — no apikey → expect 401** (our code, fail-closed): `curl -i -X POST .../process-week-results -H 'Content-Type: application/json' -d '{}'`. Anything other than 401 ⇒ function is unprotected ⇒ **STOP**.
2. **6b/6d — invalid apikey → expect 401** (platform gateway): wrong/fake key. Confirms layered defense.
3. **6c — real cron key → expect 200** (user runs, holds the value). **Scope it to avoid mutating production standings:** send body `{"league_id":"<seeded test league or a nonexistent uuid>"}` so it returns `processed:0` while still proving the guard's accept branch (the guard runs before body parsing, so a scoped 200 fully validates auth). Do **not** run an all-leagues happy path against prod as the auth test.
4. **Harness end-to-end:** `simulation-test-runner.mjs` is **self-contained** — its `seedLeague()` creates a fresh league (generated id) and `cleanup()` tears it down, so there is **no dependency on a persistent seeded league**; that create→invoke→teardown flow IS the end-to-end test. (Use this runner, not `simulate-season.sh`, which needs the manual `seed-test-league.sql` step and a fixed league id.) With both `SB_SECRET_KEY_CRON` and `SUPABASE_SERVICE_ROLE_KEY` exported, run it and confirm it authenticates (cron key) and completes a full create/run/teardown cycle.

Record 6a–6d sources of rejection (our code vs gateway), exactly as 2b-1 did.

### A7. 🛑 STOP for user review, then merge
When **all** of A6 is green: commit Sub-phase A, write up the A results, and **STOP — do not start B or C.** Hand the A results to the user for review. After the user approves, merge `phase-2b2a-process-week-results` → main. Only then branch `phase-2b2bc-cron-functions` off updated main and continue with B + C.

---

## SUB-PHASE B — `snapshot-week-start`

### B1. config.toml
Add:
```toml
[functions.snapshot-week-start]
verify_jwt = false
```

### B2. `supabase/functions/snapshot-week-start/index.ts`
- **Apply the 2b-1 apikey pattern** (guard first in handler). The function reads `X-Retry-Attempt` immediately after — leave that untouched; the guard does not interfere.
- Swap `SERVICE_ROLE = env('SUPABASE_SERVICE_ROLE_KEY')` → `SECRET_KEY = env('SB_SECRET_KEY_INTERNAL')`; update `createClient` and the missing-config check.

### B3. Cron migration — `supabase/migrations/20260618000001_migrate_snapshot_week_start_cron_auth.sql`
- Unschedule + reschedule job **`snapshot-week-start`**, schedule `35 14 * * 1,2`, body `{}`, header `apikey` from `cron_apikey`.
- **Redefine `schedule_snapshot_retry()`** carrying BOTH branches on apikey: take the 2b-1 version (`20260612000000`) as the base (its `snapshot-week-end` branch is already apikey), and migrate the remaining `snapshot-week-start` branch from legacy Bearer → `apikey: <cron_apikey>`. **Preserve the `X-Retry-Attempt` header** on the retry POST. Do not alter the `snapshot-week-end` branch.

### B4. Deploy + apply + gate
- **Deploy then immediately apply the cron migration, same session, no gap** (same gap-401 reasoning as A5): `supabase functions deploy snapshot-week-start --no-verify-jwt`, then right away `supabase db push` (dry-run first).
- Verify live `snapshot-week-start` job shows apikey auth.
- Security gate: 6a (no key → 401, our code), 6c (real key → 200; happy path is benign — skips if snapshots already exist for the week). Optionally exercise the retry path by confirming the redefined `schedule_snapshot_retry('snapshot-week-start', ...)` schedules a job whose command uses apikey.
- Commit Sub-phase B.

---

## SUB-PHASE C — `sync-alpaca-orders` (cron-only)

### C1. config.toml
Add:
```toml
[functions.sync-alpaca-orders]
verify_jwt = false
```
(Currently absent → defaults to `verify_jwt = true`; this is the flip that exposes it, so the guard is mandatory.)

### C2. `supabase/functions/sync-alpaca-orders/index.ts`
- **Apply the 2b-1 apikey pattern.** Place the guard after the existing `OPTIONS`/method (`405`) checks (preflight carries no secret) but before the body parse / any DB or Alpaca work. Use the existing `json()` helper for the 401.
- Swap the admin client: `SERVICE_ROLE = env('SUPABASE_SERVICE_ROLE_KEY')` → `SB_SECRET_KEY_INTERNAL`; update `createClient(admin, ...)` and the missing-config check.
- **Minimal change:** do NOT delete the `verify`/`sync` user-auth code or the `authed`/`ANON_KEY` client. They become unreachable but harmless. The report must explicitly state these modes are now **USER-UNREACHABLE** (Phase 5 should treat them as non-functional dead code, not live features).

### C3. Cron migration — `supabase/migrations/20260618000002_migrate_sync_alpaca_orders_cron_auth.sql`
Unschedule + reschedule job **`sync-alpaca-orders`**, schedule `30 21 * * 1-5`,
**body `{"mode":"sync-all"}`** (must preserve — without it mode defaults to `sync` →
`not_authenticated`), header `apikey` from `cron_apikey`.

### C4. Deploy + apply + gate
- **Deploy then immediately apply the cron migration, same session, no gap** (same gap-401 reasoning as A5) — and note this flip is true→false on `verify_jwt`, so the deploy is the moment the function goes public: `supabase functions deploy sync-alpaca-orders --no-verify-jwt`, then right away `supabase db push` (dry-run first).
- Verify live job shows apikey auth and retains the `{"mode":"sync-all"}` body.
- Security gate: 6a (no key → 401), 6c (real key + `{"mode":"sync-all"}` → 200). Optionally confirm a real key with no/`sync` mode now returns `not_authenticated` (documents the unreachable path).
- Commit Sub-phase C.

---

## Deliverable

`docs/migrations/MIGRATION_PHASE_2B2_REPORT.md` (alongside the other phase reports), covering, per sub-phase A/B/C:
1. config.toml change
2. Function diff (guard + internal-key swap)
3. Cron migration (file, unschedule/reschedule SQL, confirmation the exact live job name + schedule were matched)
4. Cron applied — `cron.job` query output showing new auth
5. Security gate results — 6a/6b/6c(/6d) with source-of-rejection, plus (Sub-phase A) the harness end-to-end pass
And overall:
6. Harness migration (`simulation-test-runner.mjs`, `simulate-season.sh` function call) + `.env` widening + `api-keys-inventory.md` update
7. `schedule_snapshot_retry` both-branches-on-apikey confirmation
8. Explicit note: `sync-alpaca-orders` `verify`/`sync` modes now user-unreachable (Phase 5)
9. Explicit note: legacy `service_role_key` vault entry now orphaned (Phase 5)
10. Files changed (git diff stat)
11. Concerns / anomalies
12. Ready for Phase 3? (yes/no)

Leave on the branch; do not merge to main until the user reviews the report.

---

## Stop conditions

Halt and report immediately if:
- Sub-phase A gate (6a no-key→401, or 6c scoped real-key→200, or harness pass) fails — do not touch B or C.
- Any security test returns an unexpected status (6a/6b/6d not 401, or 6c not 200) for any function.
- The constant-time / fail-closed guard cannot be implemented as in 2b-1.
- A live cron job name or schedule cannot be confirmed against the source migration (do not guess).
- `supabase db push` dry-run shows any unexpected pending migration.
- Redefining `schedule_snapshot_retry()` would drop or alter the already-migrated `snapshot-week-end` branch.
- Any uncertainty about whether a change affects `snapshot-week-end` or the client functions.

---

## Out of scope

- `snapshot-week-end` and client functions (already migrated).
- PostgREST / data-plane key usage in `simulate-season.sh` and other scripts (Phase 3).
- Removing the orphaned `service_role_key` vault entry; deleting the dead `verify`/`sync` code in `sync-alpaca-orders` (Phase 5).
- Disabling legacy keys in the dashboard (Phase 4).
