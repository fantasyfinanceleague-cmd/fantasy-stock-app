# Supabase API Key Migration — STATUS

**This is a living document. Update it at every phase boundary.** It exists so any fresh Claude Code session (or future-you) can get up to speed in 60 seconds. For detailed records, see the per-phase report files referenced below.

Last updated: Phase 2b-2 Sub-phase B done on branch `phase-2b2bc-cron-functions` (`snapshot-week-start` migrated to apikey auth, gate passed; awaiting B+C merge). Sub-phase A already merged to main (`e92ce06`). Sub-phase C (`sync-alpaca-orders`) held for user review before starting. See `MIGRATION_PHASE_2B2_REPORT.md`.

---

## The goal

Migrate this project from legacy Supabase API keys (`anon` / `service_role` JWTs) to the new key system (`sb_publishable_...` / `sb_secret_...`). Reason: legacy keys were leaked in git history; the new system lets us make the leaked keys inert and is the path Supabase is steering all projects toward. End goal is a setup that survives Supabase eventually killing legacy JWT support entirely — nothing of ours should depend on legacy-key backwards compatibility.

---

## Current state (what's done, what's not)

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Audit of full migration scope | ✅ DONE — see `MIGRATION_PHASE_0_REPORT.md` |
| 1 | Set up new keys alongside legacy (function secrets + local .env) | ✅ DONE — see `MIGRATION_PHASE_1_REPORT.md` |
| 2a | Migrate 7 client-invoked edge functions to new keys | ✅ DONE & MERGED to main — see `MIGRATION_PHASE_2A_REPORT.md` |
| 2b-1 | Proof-of-concept: migrate 1 cron function (`snapshot-week-end`) to apikey auth | ✅ DONE & MERGED to main — spec: `MIGRATION_PHASE_2B1_SNAPSHOT_WEEK_END.md`, report: `MIGRATION_PHASE_2B1_REPORT.md` |
| 2b-2 | Migrate remaining 3 cron functions. Spec: `MIGRATION_PHASE_2B2_SPEC.md` | 🔄 IN PROGRESS — **A `process-week-results` ✅ DONE & MERGED** (`e92ce06`); B `snapshot-week-start` ⏸️; C `sync-alpaca-orders` ⏸️ |
| 3 | Migrate clients (mobile, web, local scripts) to new keys | ⏸️ NOT STARTED |
| 4 | Disable legacy keys in Supabase dashboard (one-way door) | ⏸️ NOT STARTED |
| 5 | Cleanup (orphaned secrets, `.claude/settings.local.json`, docs, git history scrub) | ⏸️ NOT STARTED |

---

## Keys: current inventory

**New keys created (4):** in Supabase dashboard, "Publishable and secret API keys" tab
- `default` (publishable)
- `cron` (secret)
- `edge-functions-internal` (secret)
- `local-scripts` (secret)

**New keys as function secrets:** `SB_PUBLISHABLE_KEY`, `SB_SECRET_KEY_INTERNAL`, `SB_SECRET_KEY_CRON`

**New keys in local `.env`:** `SB_PUBLISHABLE_KEY`, `SB_SECRET_KEY_LOCAL_SCRIPTS`

**Legacy keys (still active):** `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — still used by cron functions and clients until those phases complete. Disabled in Phase 4.

See `docs/api-keys-inventory.md` for the full location matrix.

---

## Edge functions: migration status

**Client-invoked (10 total):**
- ✅ Migrated to new keys: `quote`, `place-order`, `save-broker-keys`, `get-broker-keys`, `refresh-symbols`, `symbols-search`, `symbol-name`
- ➖ No change needed (no Supabase auth): `finnhub-quote`, `ticker-quotes`, `historical-bars`

**Cron-invoked (4 total):**
- ✅ `snapshot-week-end` — Phase 2b-1, migrated to apikey auth & merged
- ✅ `process-week-results` — Phase 2b-2 Sub-phase A, migrated to apikey auth & merged (`e92ce06`). The publicly-unauthenticated hole is now CLOSED — it's guarded by a constant-time, fail-closed apikey check against `SB_SECRET_KEY_CRON`; the `process-weekly-matchups` cron job sends the `cron_apikey` vault secret.
- ✅ `snapshot-week-start` — Phase 2b-2 Sub-phase B, migrated to apikey auth. Code + gate done on branch `phase-2b2bc-cron-functions` (awaiting B+C merge). `schedule_snapshot_retry()` now has BOTH branches on apikey. (See retry-path bug in gotchas — pre-existing, separate task.)
- ⏸️ `sync-alpaca-orders` — Phase 2b-2 Sub-phase C (held for user review after B)

---

## Cron auth pattern (the hard part)

Cron functions are being migrated from `Authorization: Bearer <vault service_role JWT>` to `apikey: <sb_secret cron key>` header auth. This requires, per function:
1. `verify_jwt = false` in `supabase/config.toml`
2. Custom apikey validation in the function code (constant-time comparison, fail closed)
3. A vault entry holding the cron apikey (`cron_apikey`), separate from the old `service_role_key` entry
4. The cron migration rewritten to send the apikey header

Chosen approach: full migration (no dependency on legacy JWT backwards-compat), so it survives Supabase killing legacy keys.

---

## Key learnings / gotchas discovered

- ✅ **`process-week-results` public-auth hole is now CLOSED** (Phase 2b-2 Sub-phase A, merge `e92ce06`). It previously had `verify_jwt = false` with NO apikey check — anyone on the internet could invoke this money-adjacent function (a PRE-EXISTING hole, predating Phase 2b). It was fixed FIRST in 2b-2 and merged on its own. The fix was verified: 6a no-key → 401 from our code (fail-closed guard running), 6b/6d invalid → gateway 401, 6c real key → 200 (scoped to a nonexistent UUID, zero prod mutation), harness 23/23.
- 🐛 **PRE-EXISTING BUG (separate task, NOT a key-migration issue): the snapshot retry path is non-functional.** `schedule_snapshot_retry()` calls `cron.schedule(name, retry_time::timestamptz, sql)` for one-time scheduling, but this pg_cron version doesn't support the timestamp overload (only `cron.schedule(name, cron_expression, sql)`) → `cron.schedule(text, timestamp with time zone, text) does not exist`. This is original logic from `20260116000000`; 2b-1/2b-2 only changed the auth **header** inside the scheduled command, never the `cron.schedule()` signature — the auth migration is correct (the failing call's SQL shows `apikey`/`cron_apikey`). Affects BOTH `snapshot-week-start` and `snapshot-week-end` retry paths; the main weekly cron jobs are unaffected (they use the supported cron-expression form). Needs a separate fix; explicitly out of scope for 2b-2. (Discovered spot-checking the retry path during Sub-phase B.)
- During 2b-1: `snapshot-week-end` had THREE invocation paths on legacy auth, not one (weekly cron job + `trigger_week_end_snapshot()` + `schedule_snapshot_retry()`). Migrating only the cron job would have silently 401'd retries and manual recovery once `verify_jwt=false` went live. Lesson for 2b-2: enumerate ALL invocation paths per function (cron jobs, helper SQL functions, retry schedulers) before flipping the flag.
- Supabase validates the `apikey` header against the project's known keys at the GATEWAY (before the function runs). So a *garbage* apikey is rejected by the platform (401 `{"message":"Invalid API key"}`), not by our code. Our custom check is only exercised by a *valid project key that isn't the expected one* — test the guard with a real-but-wrong key, not just a fake string.
- Supabase removed the in-dashboard JWT-secret rotation; new-key migration is the only path
- New auto-injected env vars are PLURAL dictionaries (`SUPABASE_SECRET_KEYS`) not singular — but we use our own named secrets (`SB_SECRET_KEY_INTERNAL`) instead
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` env vars retain LEGACY JWT values even after disabling legacy keys (Supabase bug/behavior) — this is WHY we must rewrite functions to use new key names, not rely on auto-update
- Substitution confirmed working: `createClient(URL, sb_publishable_xxx, {headers:{Authorization: userJWT}})` works as drop-in for anon+userJWT
- Phase 1 placeholder bug: new secret keys were initially pushed with placeholder text; fixed by re-pushing real values
- `.claude/settings.local.json` embeds credentials in bash permission strings (no env block) — deferred to Phase 5
- Pre-commit hook is broken (`pre-commit not found`); all commits use `--no-verify`
- `apps/web/` IS deployed on Vercel (`vercel.json` present) — affects Phase 3
- Alpaca keys already rotated (separate from Supabase migration); dead values still in some files, harmless

---

## Working method

Spec-driven: Claude (chat) writes a phase spec → hand to Claude Code → Claude Code executes & produces a report → review report in chat before merging. Each phase works on its own git branch, atomic commits, merge to main only after verification. Sensitive key values are handled by the user directly (vault SQL, real-key curl tests), never passed through Claude Code.

---

## Next action

Sub-phases A (merged, `e92ce06`) and B (`snapshot-week-start`, done on branch `phase-2b2bc-cron-functions`, gate passed) are complete. **Next: Sub-phase C (`sync-alpaca-orders`) — HELD pending user review of B**, then C on the same `phase-2b2bc-cron-functions` branch, per `MIGRATION_PHASE_2B2_SPEC.md`.

- **C — `sync-alpaca-orders`:** cron-only (confirmed no client invokes it → dead-in-repo = dead-in-prod). Flip `verify_jwt` true→false (it's not in config.toml today), add the guard, swap internal key. Preserve the `{"mode":"sync-all"}` cron body. Its `verify`/`sync` user-auth modes become USER-UNREACHABLE — flag for Phase 5, not refactored away here.
- C: deploy + `db push` back-to-back (no gap — else the un-migrated cron 401s), then security gate (6a no-key→our 401, 6c real key→200). B and C then share a SECOND merge to main.
- After Sub-phase C lands, the legacy `service_role_key` vault entry is orphaned (no cron uses it) → Phase 5 cleanup.
- **Separate non-migration task:** fix the pre-existing `schedule_snapshot_retry()` `cron.schedule()` timestamp-overload bug (see gotchas) so the snapshot retry path can fire.
