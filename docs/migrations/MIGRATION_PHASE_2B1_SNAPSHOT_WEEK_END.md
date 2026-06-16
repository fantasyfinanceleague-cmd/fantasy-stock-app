# Supabase API Key Migration — Phase 2b-1: Cron Auth Proof of Concept (`snapshot-week-end`)

## Purpose

Migrate the **single** cron-invoked function `snapshot-week-end` from legacy JWT authentication to the new apikey-header authentication pattern. This proves the entire cron-migration pattern on a low-stakes function before applying it to the remaining 3 cron functions (especially `process-week-results`, which is money-adjacent).

This is the riskiest pattern in the whole migration because it requires setting `verify_jwt = false`, which exposes the function to the public internet. The custom apikey validation we add is the ONLY thing protecting the function after that flag is set. This spec treats that validation as security-critical.

After Phase 2b-1:
- `snapshot-week-end` authenticates via `apikey` header (new pattern), validated by custom code
- `snapshot-week-end` uses `SB_SECRET_KEY_INTERNAL` for internal DB operations
- The other 3 cron functions remain UNTOUCHED on legacy auth (Phase 2b-2)
- All 7 client functions remain on new keys (Phase 2a, already merged)

---

## Why `snapshot-week-end` is the proof-of-concept target

- Runs once weekly (Friday 21:05 UTC), so low invocation frequency
- Only writes price snapshots — does not process results, advance playoffs, or touch money
- A bug here has minimal blast radius compared to `process-week-results`
- Exercises the full new pattern (config.toml, custom validation, vault, cron migration), so success here proves the pattern

---

## Security-critical requirements

These are non-negotiable and must be implemented exactly. The function will be publicly invocable once `verify_jwt = false` is set; the apikey check is the only guard.

### Requirement 1: Constant-time comparison

Do NOT use `===` or `!==` to compare the incoming apikey against the expected value. String equality operators short-circuit on the first differing character, leaking length and content information through timing. Use a constant-time comparison.

Recommended implementation using Web Crypto (available in Deno):

```typescript
function constantTimeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  // Length difference is itself not secret-leaking here because we compare lengths first,
  // but we still do a full comparison to avoid early exit.
  if (aBytes.length !== bBytes.length) return false;
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}
```

### Requirement 2: Fail closed

If the expected key (`SB_SECRET_KEY_CRON`) env var is missing, empty, or undefined, the function must reject ALL requests with 401. It must NEVER treat a missing expected-key as "allow all." Explicitly:

```typescript
const expectedKey = Deno.env.get('SB_SECRET_KEY_CRON');
if (!expectedKey || expectedKey.length === 0) {
  console.error('SB_SECRET_KEY_CRON not configured — rejecting all requests');
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

### Requirement 3: No information leakage in error responses

A rejected request returns a generic `401 Unauthorized` with no detail about why (wrong key vs missing key vs malformed). Do not include the expected key, partial key, or specific failure reason in the response body or headers.

### Requirement 4: Validation happens before any other logic

The apikey check must be the very first thing the function does after parsing the request — before reading the body, before any DB connection, before any business logic. Reject unauthorized requests immediately.

---

## Critical constraints

- **Do NOT modify any other cron function** (`snapshot-week-start`, `process-week-results`, `sync-alpaca-orders`) — they stay on legacy auth until 2b-2
- **Do NOT modify any client-invoked function** (already migrated in 2a)
- **Do NOT disable legacy keys** in the dashboard (Phase 4)
- **Do NOT modify the vault entry used by the other 3 cron functions** — we add a NEW vault entry for the cron apikey, we do not touch the existing `service_role_key` entry that the other 3 still use
- Work on a branch, commit atomically, do not merge to main until verified and user-approved

---

## Tasks

### 1. Create a working branch

```bash
git checkout -b phase-2b1-snapshot-week-end
git branch  # confirm on new branch
```

### 2. Add the cron secret key to Vault

The cron SQL needs to read the apikey value to send it in the header. It's currently a function secret (`SB_SECRET_KEY_CRON`, set in Phase 1) but NOT in vault.

**This step must be done by the user in the Supabase SQL Editor** (vault operations are sensitive and the value should not pass through Claude Code). Provide the user with this SQL to run, instructing them to replace the placeholder with the actual `cron` secret key value from the dashboard:

```sql
-- Run in Supabase SQL Editor. Replace the placeholder with the actual cron secret key value.
SELECT vault.create_secret(
  'PASTE_CRON_SECRET_KEY_VALUE_HERE',
  'cron_apikey',
  'New API key (sb_secret) used by pg_cron to authenticate edge function invocations via apikey header'
);
```

**Important:** This creates a NEW vault entry named `cron_apikey`. It does NOT modify the existing `service_role_key` entry (which the other 3 cron functions still use). Both coexist until 2b-2 migrates the others.

Verify the new entry exists:
```sql
SELECT name, description, created_at FROM vault.secrets WHERE name = 'cron_apikey';
```

Claude Code: do not run this SQL yourself. Provide it to the user and wait for confirmation that the `cron_apikey` vault entry exists.

### 3. Create or update `supabase/config.toml`

Check whether `supabase/config.toml` exists at the repo root.

- If it does not exist: create it
- If it exists: add to it without disturbing existing content

Add the verify_jwt override for `snapshot-week-end` ONLY:

```toml
[functions.snapshot-week-end]
verify_jwt = false
```

Do NOT add verify_jwt = false for any other function in this phase.

### 4. Modify `snapshot-week-end/index.ts`

Read the current file first. Document its current structure (where it reads env vars, where the main logic starts).

Apply these changes:

**A. Add the apikey validation block** as the first thing inside the request handler, implementing all 4 security requirements above (constant-time comparison, fail closed, no info leakage, validation-first).

**B. Change the internal DB client** from legacy service_role to new secret key:
```typescript
// OLD:
const SERVICE_ROLE = env('SUPABASE_SERVICE_ROLE_KEY');
// NEW:
const SECRET_KEY = env('SB_SECRET_KEY_INTERNAL');
```
And update the `createClient` call to use `SECRET_KEY`.

**C. Keep all existing business logic** (the actual snapshot logic) unchanged.

### 5. Deploy with verify_jwt disabled

```bash
supabase functions deploy snapshot-week-end --no-verify-jwt
```

The `--no-verify-jwt` flag plus the config.toml entry together ensure the platform stops JWT-verifying this function. (The config.toml makes it persistent across deploys; the flag applies it for this deploy.)

### 6. Test the security validation FIRST (before testing happy path)

This order matters. Verify the function REJECTS bad requests before confirming it accepts good ones.

**Test 6a — no apikey header → expect 401:**
```bash
curl -i -X POST "https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/snapshot-week-end" \
  -H "Content-Type: application/json" -d '{}'
```
Expect: `HTTP/2 401`. If it returns 200, the validation is broken — STOP immediately, the function is unprotected.

**Test 6b — wrong apikey → expect 401:**
```bash
curl -i -X POST "https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/snapshot-week-end" \
  -H "Content-Type: application/json" \
  -H "apikey: sb_secret_wrongvalue_definitely_not_real" -d '{}'
```
Expect: `HTTP/2 401`. If it returns 200, validation is broken — STOP.

**Test 6c — correct apikey → expect 200:**
The user runs this with the real cron secret key value (Claude Code should NOT have the value; provide the curl template and let the user fill it in):
```bash
curl -i -X POST "https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/snapshot-week-end" \
  -H "Content-Type: application/json" \
  -H "apikey: PASTE_REAL_CRON_KEY" -d '{}'
```
Expect: `HTTP/2 200` with the normal snapshot response body.

If 6a or 6b return anything other than 401, the security validation has failed. Stop, report, do not proceed.

### 7. Rewrite the cron migration for `snapshot-week-end`

Find the migration that schedules the `snapshot-week-end` cron job (per Phase 0 audit, likely `20260116000000_matchup_scoring_redesign.sql` around lines 101-114).

**Important context on migration rewriting:** This cron job is already scheduled and running in production from the original migration. We need to update the live cron job's definition. Creating a NEW migration that re-defines the cron job is cleaner than editing the old migration (which has already run). 

Create a new migration file: `supabase/migrations/<timestamp>_migrate_snapshot_week_end_cron_auth.sql` with:

```sql
-- Unschedule the existing snapshot-week-end cron job and reschedule it
-- using apikey-header auth with the new cron_apikey vault secret instead of
-- the legacy service_role_key Bearer token.

SELECT cron.unschedule('snapshot-week-end');  -- use the actual existing job name from the original migration

SELECT cron.schedule(
  'snapshot-week-end',
  '5 21 * * 5',  -- preserve the existing schedule (Fri 21:05 UTC) — verify against original migration
  $$
  SELECT net.http_post(
    url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/snapshot-week-end',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_apikey' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
```

**Verify the exact existing job name and schedule** against the original migration before writing this. Do not guess — read the original migration and match the job name and cron expression exactly.

Do NOT apply the migration yet (next step handles that deliberately).

### 8. Apply the cron migration

This updates the live cron schedule. The user should run this, since it modifies production cron:

```bash
supabase db push
```

Or, if the user prefers to apply just this one migration's SQL manually via the SQL Editor, provide the SQL for them to run directly. Either way, after applying:

Verify the cron job now uses the new auth:
```sql
SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'snapshot-week-end';
```

The `command` should show the `apikey` header with `cron_apikey`, NOT the old `Authorization Bearer service_role_key`.

### 9. End-to-end verification

The ultimate test: does the cron job, using the new apikey auth, successfully invoke the function?

Option A (wait for natural run): the cron runs Friday 21:05 UTC. Too slow for verification.

Option B (manually trigger the exact cron SQL): run the cron job's command manually in SQL Editor to simulate what pg_cron will do:
```sql
SELECT net.http_post(
  url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/snapshot-week-end',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_apikey' LIMIT 1)
  ),
  body := '{}'::jsonb
) as request_id;
```

This returns a `request_id`. Then check the function logs (Dashboard → Edge Functions → snapshot-week-end → Logs) for a 200 response within a few seconds. A 200 confirms: vault has the right key → cron SQL reads it → sends as apikey → function validates it → executes. The entire new pattern works end-to-end.

If the logs show 401, the vault value and the function's expected value don't match. Debug before proceeding.

---

## Deliverable

`MIGRATION_PHASE_2B1_REPORT.md` at repo root:

1. **Branch created**
2. **Vault entry** — confirm `cron_apikey` created (by user)
3. **config.toml** — created or modified, content shown
4. **Function changes** — apikey validation block (show the security-critical code), internal DB client change, lines modified
5. **Security test results** — 6a (no key→401), 6b (wrong key→401), 6c (right key→200). ALL THREE must pass.
6. **Cron migration** — new migration file, the unschedule/reschedule SQL, confirmation existing job name and schedule were matched against the original
7. **Cron migration applied** — confirmation, plus the `cron.job` query output showing new auth
8. **End-to-end verification** — request_id from manual trigger, log result (200 expected)
9. **Files changed** — git diff stat
10. **Concerns/anomalies**
11. **Ready for Phase 2b-2?** — yes/no

Do NOT commit beyond the branch, do NOT merge to main until user reviews.

---

## Stop conditions

Halt and report immediately if:

- Security test 6a or 6b returns anything other than 401 (function is unprotected — critical)
- Security test 6c returns anything other than 200 (legitimate cron can't authenticate)
- The constant-time comparison or fail-closed logic cannot be implemented as specified
- The existing cron job name or schedule cannot be determined from the original migration (do not guess)
- `supabase db push` reports unexpected migrations or conflicts
- The end-to-end manual trigger returns 401 in logs
- Any uncertainty about whether a change affects the other 3 (still-legacy) cron functions

For any stop: capture specifics, do not improvise, report.

---

## Out of scope

- The other 3 cron functions (Phase 2b-2)
- Client functions (done in 2a)
- Disabling legacy keys (Phase 4)
- Removing the old `service_role_key` vault entry (still used by the other 3 cron functions — removed in 2b-2 or Phase 5)
- Client/script migration (Phase 3)
