# Supabase API Key Migration — Phase 2a: Client-Invoked Edge Functions

## Purpose

Modify the **10 client-invoked edge functions** to read the new `SB_SECRET_KEY_INTERNAL` and `SB_PUBLISHABLE_KEY` env vars (set up in Phase 1) instead of the legacy `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` env vars.

After Phase 2a:
- Client-invoked functions use new keys for all internal Supabase operations
- Cron-invoked functions are **untouched** and continue using legacy keys via vault (Phase 2b territory)
- Legacy keys remain active in Supabase (Phase 4 disables them)
- Client apps (mobile, web, scripts) still send legacy `anon` key in their `apikey`/`Authorization` headers — those clients aren't updated until Phase 3

This isolates risk: if anything breaks, cron is unaffected and we have a clean diff to revert.

---

## Critical context

### The 10 client-invoked functions in scope

From the Phase 0 audit:

| Function | Reads `SUPABASE_URL` | Reads `SUPABASE_ANON_KEY` | Reads `SUPABASE_SERVICE_ROLE_KEY` | Reads other secrets |
|----------|:-:|:-:|:-:|---|
| `quote` | ✓ | ✓ | ✓ | `BROKER_CRYPTO_KEY` |
| `place-order` | ✓ | ✓ | ✓ | `BROKER_CRYPTO_KEY` |
| `get-broker-keys` | ✓ | ✓ | ✓ | `BROKER_CRYPTO_KEY` |
| `save-broker-keys` | ✓ | ✓ | ✓ | `BROKER_CRYPTO_KEY` |
| `refresh-symbols` | ✓ | | ✓ | |
| `symbols-search` | ✓ | ✓ | | `ALPACA_API_KEY`, `ALPACA_API_SECRET` |
| `symbol-name` | ✓ | ✓ | | |
| `finnhub-quote` | | | | `FINNHUB_API_KEY` |
| `ticker-quotes` | | | | `ALPACA_API_KEY`, `ALPACA_API_SECRET` |
| `historical-bars` | | | | `ALPACA_API_KEY`, `ALPACA_API_SECRET` |

Three of these (`finnhub-quote`, `ticker-quotes`, `historical-bars`) don't read Supabase auth secrets at all — they only call third-party APIs. **These three functions need NO changes for Phase 2a.** They're listed for completeness but are out of scope.

**Effective in-scope count: 7 functions.**

### The 4 cron-invoked functions explicitly NOT in scope

`process-week-results`, `snapshot-week-start`, `snapshot-week-end`, `sync-alpaca-orders` — DO NOT modify these in Phase 2a even if you notice they use the same patterns. Cron auth changes happen in Phase 2b.

### The substitution assumption

The migration assumes Supabase's documented claim is accurate: *"You can substitute the sb_publishable_... and sb_secret_... values anywhere you used the anon and service_role keys respectively. They work roughly the same in terms of permissions and data access. You can initialize any version of the Supabase Client libraries with the new values without any additional changes."*

This means:
- `createClient(URL, sb_secret_xxx)` should work as a drop-in for `createClient(URL, service_role_jwt)`
- `createClient(URL, sb_publishable_xxx, { global: { headers: { Authorization: req.headers.get('Authorization') }}})` should work as a drop-in for the same with `anon_jwt` — with the user JWT forwarded for RLS

The smoke tests in this spec verify both assumptions. If they fail, **stop and report**.

---

## Critical constraints

- **Do NOT modify any of the 4 cron-invoked functions** (`process-week-results`, `snapshot-week-start`, `snapshot-week-end`, `sync-alpaca-orders`)
- **Do NOT modify any migration files** (cron auth stays on legacy `service_role_key` from vault)
- **Do NOT modify `supabase/config.toml`** (verify_jwt changes happen in Phase 2b)
- **Do NOT modify any client code** (mobile, web, scripts continue using legacy keys — Phase 3)
- **Do NOT delete any function secrets**
- **Do NOT click "Disable legacy API keys"** in the dashboard
- **Do NOT touch the Supabase Vault** (cron uses it; leave it alone)
- **Do NOT modify functions outside the 7-function scope** even if they look similar
- If anything looks misconfigured during the work, **note it; do not fix it** (out of scope)

---

## Tasks

### 1. Create a working branch

Before touching code, create a branch so we can revert cleanly if needed:

```bash
git checkout -b phase-2a-client-functions
```

Verify: `git branch` should show `* phase-2a-client-functions`.

### 2. Inventory current state of each in-scope function

For each of the 7 in-scope functions, read `supabase/functions/<function>/index.ts` and document:

- Exact line numbers of every `Deno.env.get('SUPABASE_ANON_KEY')` call
- Exact line numbers of every `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` call
- Whether the function uses the user-JWT-forwarding pattern (`global: { headers: { Authorization: ... }}`)
- Whether the function uses both an `authed` (user-context) client and an `admin` (service-role) client

Output as a table in the report. This is your map for the modifications.

### 3. Plan the per-function changes

For each in-scope function, the change is mechanical:

**Replace:**
```typescript
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
```
**With:**
```typescript
const PUBLISHABLE_KEY = Deno.env.get('SB_PUBLISHABLE_KEY')!;
```

**Replace:**
```typescript
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
```
**With:**
```typescript
const SECRET_KEY = Deno.env.get('SB_SECRET_KEY_INTERNAL')!;
```

Then update the variable references in the `createClient` calls accordingly. Variable naming is a stylistic choice — using `PUBLISHABLE_KEY`/`SECRET_KEY` instead of `ANON_KEY`/`SERVICE_ROLE` makes it clear at the read site that we're using new keys.

**Important:** Keep the `createClient(URL, KEY, { global: { headers: { Authorization: ... }}})` pattern intact for user-context operations. Just substitute the key value, not the structure. Per Supabase's documented claim, this should work.

### 4. Apply the changes one function at a time

For each in-scope function, in this order (lowest blast radius first):

1. `symbol-name` — simplest, rarely called, easy to verify
2. `symbols-search` — similar to symbol-name
3. `refresh-symbols` — admin-only operation, easier to reason about
4. `quote` — heavily used, but has good error visibility
5. `get-broker-keys` — security-sensitive but read-only
6. `save-broker-keys` — security-sensitive and writes
7. `place-order` — most critical (places trades)

For each function:
- Make the env var changes
- Save the file
- Deploy with `supabase functions deploy <function-name>` (NO `--no-verify-jwt` flag — these are client-invoked functions that should still verify the user's JWT)
- Smoke test (see task 5)
- If smoke test fails, **stop and report**. Do not continue to the next function.
- If smoke test passes, move to the next function

### 5. Smoke test pattern

After each function is deployed, smoke test it. The exact test depends on the function:

**For functions that don't require user context** (`refresh-symbols`, `symbol-name`, `symbols-search`):
- Invoke from the Supabase dashboard's "Invoke" UI on the function page, OR
- Use `curl` with the legacy anon key (since clients still use legacy):
  ```bash
  curl -X POST "https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/<function>" \
    -H "Authorization: Bearer <legacy_anon_key>" \
    -H "apikey: <legacy_anon_key>" \
    -H "Content-Type: application/json" \
    -d '{"<test payload appropriate for function>"}'
  ```
- Expected: 200 OK with valid response body
- If 401/500: stop, check logs in Supabase dashboard

**For functions that require user context** (`quote`, `get-broker-keys`, `save-broker-keys`, `place-order`):
- These need a real user JWT to test the user-context client behavior
- Easiest: invoke from the mobile app while it's running locally on Expo Go
- Alternative: get a user JWT manually via Supabase dashboard's auth UI, paste into a curl command
- Expected: function returns the same response shape as before the change
- **Critical check:** Verify the function can both (a) read user-context data via the publishable client (RLS works) and (b) perform admin operations via the secret client (bypasses RLS). If only one works, the substitution assumption is partially failing and needs investigation.

### 6. After all 7 functions deployed and smoke-tested

Run a comprehensive integration test:

```bash
node scripts/simulation-test-runner.mjs
```

The simulation harness uses `place-order`, `process-week-results`, and other functions. **`process-week-results` is still on legacy keys (Phase 2b not done yet)**, so it should still work. The migrated functions (especially `place-order`) get exercised by this test.

Expected: 23/23 pass, same as the most recent baseline run.

If any test fails, capture the failure log and **stop and report**.

### 7. Verify cron is still working

This is the safety check that confirms 2a didn't accidentally affect cron. Check the most recent cron invocation in Supabase dashboard:

- Edge Functions → `sync-alpaca-orders` → Logs (last weekday's run)
- Or wait for next scheduled cron and verify

If a cron run happens during 2a deployment work and fails: that's important data — report immediately.

---

## Deliverable

A single markdown file: `MIGRATION_PHASE_2A_REPORT.md` at the repo root, with sections:

1. **Branch created** — confirm `phase-2a-client-functions` branch
2. **Function inventory (task 2)** — table of in-scope functions and current env var usage
3. **Per-function deployment results (task 4)** — for each function: lines changed, deploy status, smoke test result
4. **Substitution assumption verification** — confirmation that publishable + user-JWT pattern works for user-context calls, and that secret key works for admin calls
5. **Simulation harness result (task 6)** — pass/fail count
6. **Cron verification (task 7)** — most recent cron status
7. **Files changed** — `git diff main --stat` output
8. **Concerns or anomalies** — anything unexpected
9. **Ready for Phase 2b?** — yes/no based on whether everything in 2a is clean

**Do NOT commit the changes yet.** They sit on the `phase-2a-client-functions` branch, uncommitted, until the user reviews the report and approves merging to main.

---

## Out of scope

- The 4 cron-invoked functions (Phase 2b)
- The 3 functions that don't read Supabase auth secrets (`finnhub-quote`, `ticker-quotes`, `historical-bars` — no changes needed)
- Migration files (Phase 2b)
- `supabase/config.toml` changes (Phase 2b)
- Client code (Phase 3)
- Disabling legacy keys (Phase 4)
- Cleanup of unused secrets (Phase 5)
- `.claude/settings.local.json` (Phase 5)

---

## Stop conditions

Halt and report (do not proceed to next function or task) if any of these occur:

- Any function smoke test returns 401 or 500
- The substitution assumption fails (e.g., `createClient(URL, sb_publishable_xxx, { global: { headers: { Authorization: <user_jwt> }}})` doesn't actually authenticate the user)
- The simulation harness fails any of the 23 tests
- A cron run happens during Phase 2a work and fails
- A function deploy command errors out
- Any unexpected behavior that isn't covered by this spec

For each stop condition: capture the specific error, the function involved, the relevant log lines, and report. **Do NOT attempt to fix on the fly.** Stopping with good data is better than improvising and creating compounding errors.
