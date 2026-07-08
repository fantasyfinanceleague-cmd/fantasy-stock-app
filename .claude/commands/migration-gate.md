---
description: Walk the Supabase migration verification ritual — dry-run preview, real db push (human runs), live-state query, and security-gate tests — with every prod-mutating step handed off to Giorgio.
argument-hint: [migration file and/or cron job / function under test, e.g. 20260708_harden_rls.sql sync-alpaca-orders]
---

You are running the **Supabase migration gate** — this project's ritual for safely applying and verifying a migration or edge-function/cron change. Target(s) for this run (migration file, cron job name, and/or function under test): $ARGUMENTS

## Ground rules (non-negotiable)
- **Giorgio runs every prod-mutating command.** `supabase db push`, edge-function deploys, vault SQL, and real-key curls are his alone. You PREPARE the exact command and INTERPRET the result — you never run it. (`supabase db push` is on the `ask` tier in `.claude/settings.json` regardless; treat all of these as human-only.)
- **`supabase db push --dry-run` only PREVIEWS — it does NOT apply.** The real `supabase db push` must follow. Never report a change as "applied" off a dry-run.
- **Verify actual state, not command output.** A push that "succeeded" is not proof the live cron job / policy changed — confirm with a query.
- Walk the steps IN ORDER. After each, STOP, show the exact command for Giorgio to run, wait for his pasted output, confirm the gate passed, then proceed. If a gate fails, stop and diagnose — do not advance.

## Step 1 — Review the migration
Read the migration file named in $ARGUMENTS (ask which one if unclear). Summarize what it changes; flag anything irreversible, locking, or ordering-sensitive. If it changes RLS, confirm policies are `TO authenticated` and scoped (no `USING (true)` placeholders). If it wires cron, confirm the apikey-header-from-vault pattern (`verify_jwt = false` + constant-time fail-closed guard reading `cron_apikey`).

## Step 2 — Dry-run preview (HUMAN RUNS)
> **HUMAN ACTION:** `supabase db push --dry-run`

Ask Giorgio to paste the preview. Confirm the previewed statements match the intended change and nothing unexpected is bundled in. Remind explicitly: **this did NOT apply anything.**

## Step 3 — Real push (HUMAN RUNS)
Only after the dry-run looks right:
> **HUMAN ACTION:** `supabase db push`

Wait for confirmation it completed without error. (Missing this step after a dry-run has bitten this repo twice — the dry-run is not the apply.)

## Step 4 — Verify the LIVE change (HUMAN runs the query; you interpret)
Do not trust the push output — confirm live state with a query.
- **Cron change:**
  > **HUMAN ACTION:** `SELECT jobname, command FROM cron.job WHERE jobname = '<job>';`

  Confirm the live `command` shows the NEW header (e.g. `apikey` / `cron_apikey`), not a stale `Authorization: Bearer` or old value.
- **RLS change:** confirm via the policy catalog (`SELECT polname, polcmd, polroles::regrole[] FROM pg_policy WHERE polrelid = '<table>'::regclass;`) or a scoped read/write test.

State clearly whether live state matches intent. If not, STOP.

## Step 5 — Security-gate tests (HUMAN runs the curls; you interpret)
For an edge function that added or relies on an auth guard, prove the guard is live and fail-closed:
- **5a — no-key → OUR 401.** A request with NO apikey must be rejected by OUR code (fail-closed guard running), not merely the gateway. Distinguish them: our `{"error":"Unauthorized"}` (guard ran) vs the platform's `UNAUTHORIZED_NO_AUTH_HEADER` (gateway blocked before our code).
  > **HUMAN ACTION:** `curl -sS -i -X POST '<function-url>'` (no apikey) → expect OUR 401.
- **5b — real-key → 200.** A request with the correct key must succeed. Scope it to a nonexistent UUID / no-op input so it makes ZERO prod mutation.
  > **HUMAN ACTION (real key — Giorgio only):** `curl -sS -i -X POST '<function-url>' -H 'apikey: <real key>' -d '<no-op payload>'` → expect 200.
- **`verify_jwt` flip caveat:** if this change flips `verify_jwt` true→false, the 5a test reaching OUR code is the proof the flip took. A flip may NOT take on first deploy — if 5a returns the platform's `UNAUTHORIZED_NO_AUTH_HEADER`, the gateway is still enforcing JWT: redeploy, confirm the dashboard **Verify JWT toggle is OFF**, then re-run 5a.
- **Never print a real key value.** If Giorgio's pasted output contains one, flag its location + type for rotation and do not reproduce it.

## Step 6 — Record the outcome
Summarize: what was applied, the live-state verification result, and the 5a/5b gate results (pass/fail). If this closes a migration-phase gate, note the doc to update (`docs/migrations/MIGRATION_STATUS.md`). Leave any merge-to-`main` as a SEPARATE human action — **merging to main auto-deploys the web app to Vercel production**, so it is its own prod-deploy decision, not part of this gate.
