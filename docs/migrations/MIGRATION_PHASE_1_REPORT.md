# Supabase API Key Migration — Phase 1 Report

## 1. Existing Keys Found in Dashboard (Task 1)

Completed by user prior to this session. The Supabase dashboard was checked and existing exploratory keys were noted. Decision was made to create fresh, named keys per the spec recommendation.

---

## 2. Keys Created in This Phase (Task 2)

4 new keys created in Supabase dashboard by user:

| Name | Type | Dashboard name | Local prefix |
|------|------|----------------|--------------|
| `default` | sb_publishable | default | `sb_publishable_c8J...` |
| `cron` | sb_secret | cron | (function secret only) |
| `edge-functions-internal` | sb_secret | edge-functions-internal | (function secret only) |
| `local-scripts` | sb_secret | local-scripts | `sb_secret_nCYJf2s...` |

---

## 3. Function Secrets Set (Task 3)

3 new function secrets pushed via `supabase secrets set --env-file .env.new-keys`:

| Secret name | Digest (current) | Status |
|-------------|-------------------|--------|
| `SB_SECRET_KEY_CRON` | `e858ce130360c32f...` | NEW |
| `SB_SECRET_KEY_INTERNAL` | `45c4ce374c745...` | NEW |
| `SB_PUBLISHABLE_KEY` | `a8bfee8cb0e0eb...` | NEW |

### Legacy secret digest comparison (Phase 0 → Phase 1)

| Secret | Phase 0 digest | Phase 1 digest | Status |
|--------|---------------|----------------|--------|
| `SUPABASE_ANON_KEY` | `f8ecc63288638e...` | `f8ecc63288638e...` | UNCHANGED |
| `SUPABASE_SERVICE_ROLE_KEY` | `6455ef2f6e2bc5...` | `89e669b86b2d9a...` | **CHANGED** |
| `SUPABASE_PUBLISHABLE_KEYS` | `87548a4376cebe...` | `87548a4376cebe...` | UNCHANGED |
| `SUPABASE_SECRET_KEYS` | `82c4015136b516...` | `9e27d1d679166...` | **CHANGED** |
| `ALPACA_API_KEY` | `f237498b79c9b7...` | `f237498b79c9b7...` | UNCHANGED |
| `ALPACA_API_SECRET` | `ad2a73bdc94080...` | `ad2a73bdc94080...` | UNCHANGED |
| `BROKER_CRYPTO_KEY` | `1f357eb2f4c19a...` | `1f357eb2f4c19a...` | UNCHANGED |
| `FINNHUB_API_KEY` | `c8935e59e0d8a6...` | `c8935e59e0d8a6...` | UNCHANGED |
| `SUPABASE_DB_URL` | `22a5c6dcc259e1...` | `22a5c6dcc259e1...` | UNCHANGED |
| `SUPABASE_JWKS` | `4f53cda18c2baa...` | `4f53cda18c2baa...` | UNCHANGED |
| `SUPABASE_URL` | `69aea402597b83...` | `69aea402597b83...` | UNCHANGED |

**2 legacy secrets have changed digests.** See Section 9 (Concerns) for analysis.

---

## 4. `.env` Updates (Task 4)

Confirmed. Local `.env` now contains 5 lines:

| Variable | Type | Status |
|----------|------|--------|
| `SUPABASE_SERVICE_ROLE_KEY` | Legacy | Present, unchanged |
| `SUPABASE_ANON_KEY` | Legacy | Present, unchanged |
| `SUPABASE_URL` | Shared | Present, unchanged |
| `SB_PUBLISHABLE_KEY` | New | Added in Phase 1 |
| `SB_SECRET_KEY_LOCAL_SCRIPTS` | New | Added in Phase 1 |

---

## 5. `.claude/settings.local.json` Updates (Task 5)

**SKIPPED.** The file embeds keys inside bash command-string permission patterns (e.g., `Bash(ANON_KEY="..." curl ...)`), not in a clean environment block. Restructuring would require rewriting dozens of permission entries and is beyond Phase 1 scope.

**Post-migration TODO:** After Phase 3 (client migration), rewrite `.claude/settings.local.json` permission entries to use new key values. Consider whether the file should reference `.env` variables instead of embedding literal key values.

---

## 6. Inventory Doc Created (Task 6)

Created at `docs/api-keys-inventory.md`. Contains:
- Active legacy keys table
- New provisioned keys table with prefixes (where available)
- Key location matrix showing where each key lives

The `cron` and `edge-functions-internal` secret key prefixes are not included because those values were only pushed to function secrets via the temp `.env.new-keys` file (now deleted) and are not stored locally. Their prefixes can be retrieved from the Supabase dashboard if needed.

---

## 7. Verification Results (Task 7)

### `supabase secrets list`
- All 3 new secrets present: `SB_SECRET_KEY_CRON`, `SB_SECRET_KEY_INTERNAL`, `SB_PUBLISHABLE_KEY`
- All 13 legacy secrets still present (names confirmed)
- Total: 16 secrets
- 2 legacy digest changes flagged (see Section 9)

### `.env` legacy key check
- `SUPABASE_SERVICE_ROLE_KEY` line present in `.env`
- `SUPABASE_ANON_KEY` line present in `.env`
- `SUPABASE_URL` line present in `.env`

### `git status`
- Branch `main`, 8 commits ahead of `origin/main`
- `.env` is gitignored — does not appear in status
- `.gitignore` shows as modified (`.env.new-keys` pattern added)
- Pre-existing uncommitted changes (UI overhaul, docs, etc.) unchanged
- New untracked files from migration work: `MIGRATION_PHASE_0_AUDIT.md`, `MIGRATION_PHASE_0_REPORT.md`, `MIGRATION_PHASE_1_SETUP.md`, `RECONCILE_WORKING_TREE.md`, `RECONCILIATION_REPORT.md`

---

## 8. Files Changed

| File | Change type | Phase 1 specific? |
|------|-------------|-------------------|
| `.env` | Modified (2 lines added) | Yes — gitignored, not visible in git status |
| `.gitignore` | Modified (`.env.new-keys` added) | Yes |
| `docs/api-keys-inventory.md` | New file | Yes |
| `MIGRATION_PHASE_1_REPORT.md` | New file | Yes (this file) |

**Nothing committed.** Per spec, commits will be batched with Phase 2.

---

## 9. Concerns and Anomalies

### RESOLVED: Two legacy secret digests changed (platform-side artifact)

`SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_SECRET_KEYS` showed different digests between the Phase 0 audit and the current `supabase secrets list` output. All other 11 legacy secrets were unchanged.

**Investigation:**

1. **Most recent cron run successful.** `sync-alpaca-orders` ran on 2026-04-29 at 14:30 UTC and completed cleanly — booted in 43ms, processed all users, clean shutdown. This invocation authenticates using `SUPABASE_SERVICE_ROLE_KEY` from the function environment. If the digest change reflected a broken value, this log would show 401s or auth failures. It does not.

2. **Legacy service_role JWT value unchanged.** Verified that the value in local `.env` matches the value shown when revealing the legacy `service_role` key in the Supabase dashboard. The underlying JWT has not been rotated.

3. **`SUPABASE_SERVICE_ROLE_KEY` is present in the function secrets list.** This is expected — it is one of Supabase's auto-injected platform secrets, alongside `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWKS`, and `SUPABASE_DB_URL`.

**Conclusion:**

The digest changes are platform-side artifacts, not changes to manually-set secrets:

- `SUPABASE_SECRET_KEYS` digest changed because three new `sb_secret_...` keys were created in the dashboard today. This auto-injected JSON dictionary aggregates the project's secret keys; creating new ones updates the dictionary contents and therefore the digest.
- `SUPABASE_SERVICE_ROLE_KEY` digest change is more opaque but is clearly not breaking anything (cron run is healthy, JWT value matches dashboard). Likely a platform-side representation change, possibly related to the partial rollout of the new key system on this project.

**No action required.** Do not run the previously-suggested `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...` command — the current value is working correctly, and overwriting an auto-injected reserved secret with a manually-set value could produce unexpected behavior.

**Documentation gap noted:** `supabase secrets list` does not visually distinguish between manually-set function secrets and auto-injected platform secrets. Both appear in the same list with digests, and platform-side state changes can cause digest changes that look like manual updates. Worth keeping in mind for future Phase audits — digest comparison alone is insufficient evidence of a real change.

### CONCERN: `.claude/settings.local.json` deferred to Phase 5

Audited (read-only) during Phase 1. Findings:

**Structure:** Top-level `permissions` object containing an `allow` array. No `env` or `environment` block exists at any level. The file does not use a standard secret-storage pattern.

**Credential embedding:** Approximately 15-20 `Bash(...)` permission entries embed credentials directly in command strings. Four credentials appear:
- Legacy Supabase `anon_key` (twice — once in a `curl` permission, once in a `supabase functions deploy` permission)
- Alpaca API key
- Alpaca API secret
- Supabase project URL (not a credential, but identifying)

**Command categories:** Mix of `curl`, `supabase`, `npm`/`npx`, `eas`, and `cat` commands.

**Stale data:** The Alpaca key/secret values embedded here are the **rotated, dead values** as of 2026-04-30. Any `Bash` permissions referencing them will fail at execution time. These entries should be removed even before Phase 5 if Claude Code attempts to use them.

**Phase 5 plan:**
1. Research whether Claude Code's `settings.local.json` schema supports an `env` block at the top level
2. If yes: move credentials to env block, rewrite permission entries to reference `$VARIABLE_NAME` syntax, add new `sb_publishable`/`sb_secret` values
3. If no: delete all credential-bearing permission entries; Claude Code will prompt for permission ad-hoc on next use, which is acceptable for an early-stage project
4. Either way: remove dead Alpaca key references

**Estimated scope:** 1-2 hours of focused work. Larger than initially scoped because there is no existing env block to extend.

**Production impact:** None. This file only affects Claude Code's pre-authorization for bash commands during interactive sessions. Production cron, edge functions, mobile app, and web app are unaffected by its contents.
