# Supabase API Key Migration — Phase 0: Audit

## Purpose

Before migrating from legacy `anon` / `service_role` JWT-based keys to the new `sb_publishable_...` / `sb_secret_...` key system, audit the current state of:

1. What new keys (if any) already exist in the Supabase project
2. What function secrets are currently set
3. How cron-invoked edge functions authenticate (the highest-risk piece)
4. What Supabase CLI version is installed (relevant: deprecation of `secrets:create` for `env:create`)

**This is read-only.** No keys created, no code changed, no secrets updated. The output is a written report that informs Phase 1+.

---

## Critical constraints

- **Do not create new keys** in the Supabase dashboard or CLI
- **Do not update or delete any existing function secrets**
- **Do not modify any edge function code, migration files, or client config**
- **Do not run the simulation harness** (it hits production; we'll smoke test deliberately later)
- **Do not deploy any edge functions**
- If anything looks misconfigured during the audit, **note it; do not fix it**

---

## Tasks

### 1. Audit existing new keys in Supabase

In the Supabase dashboard, navigate to Settings → API Keys → "Publishable and secret API keys" tab.

Document:
- How many publishable keys exist (`sb_publishable_...`). Note the prefix (first 12 chars) and creation date of each.
- How many secret keys exist (`sb_secret_...`). Note the prefix (first 12 chars) and creation date of each.
- Whether any of them are labeled or named (some users create multiple secret keys for different services).

**Do not reveal full values yet.** We don't need them at audit stage.

### 2. Audit current function secrets

In the terminal at the repo root:

```bash
supabase secrets list
```

The user has already shared a recent output showing these secrets exist:

- `ALPACA_API_KEY`, `ALPACA_API_SECRET`, `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`
- `BROKER_CRYPTO_KEY`
- `FINNHUB_API_KEY`
- `SUPABASE_ANON_KEY`
- `SUPABASE_DB_URL`
- `SUPABASE_JWKS`
- `SUPABASE_PUBLISHABLE_KEYS`
- `SUPABASE_SECRET_KEYS`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_URL`

Re-run `supabase secrets list` and confirm:

- Are these still the current secrets, or has anything changed since the prior listing?
- Is there any documentation in the project explaining what `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` (plural) are for? Search the repo for those exact strings.
- Cross-reference: which of these secrets do edge functions actually read from?

### 3. Cross-reference: which secrets do edge functions actually read?

For each `.ts` file in `supabase/functions/*/index.ts`, list every `Deno.env.get(...)` call. Build a table:

| Function | Secrets read from environment |
|----------|-------------------------------|
| `process-week-results` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `place-order` | (list all) |
| ...etc for all 14 functions |

This tells us exactly which env vars need to be present for each function to work, which informs what we update in Phase 1+.

### 4. Audit cron authentication mechanism

The 4 cron-invoked functions are:
- `snapshot-week-start`
- `snapshot-week-end`
- `process-week-results`
- `sync-alpaca-orders` (sync-all mode)

For each, find the migration that sets up the cron schedule (likely in `supabase/migrations/`). Document for each:

- The exact migration file
- The exact SQL that constructs the `Authorization` header
- The vault secret name being read (likely `service_role_key`)
- The HTTP body sent (if any)

**Specifically look for:** does the cron call use `service_role_key` from vault as a Bearer token in the `Authorization` header? This is the pattern that breaks when migrating to `sb_secret_...` keys, because `sb_secret` is not a JWT and cannot be used as a Bearer token.

Document any variations between cron functions.

### 5. Audit Supabase CLI version

```bash
supabase --version
```

The current installed version (per recent terminal output) was `2.67.1` and a newer version `2.95.4` is available. Check:

- What's the current installed version now?
- What's the latest available?
- Does the project have any `package.json` script or doc that pins a specific Supabase CLI version?

The new key system has CLI commands that may not exist in older versions. We need to know whether to update before Phase 1.

### 6. Read current Supabase migration docs

Fetch and skim these official docs to identify any constraints or gotchas:

- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/api/api-keys
- Any doc linked from the Supabase dashboard's API Keys page about migration

In the report, note:
- The exact recommended deployment flag for edge functions when using `sb_secret` (likely `--no-verify-jwt`)
- The recommended pattern for cron→edge function authentication with the new keys
- Any backwards-compatibility note about whether `sb_secret` can be sent in `Authorization: Bearer ...` headers (the docs seemed to say no, but verify)
- Any required client SDK version updates for `@supabase/supabase-js`

### 7. Check client SDK versions

```bash
cat apps/mobile/package.json | grep "@supabase"
cat apps/web/package.json | grep "@supabase"
cat package.json | grep "@supabase"
```

Document the version of `@supabase/supabase-js` (or related packages) used in each app. Cross-reference with the docs from task 6 to determine if any need updating before migration.

### 8. Flag any pre-existing weirdness

The earlier audit revealed several things that should be noted but not fixed in this phase:

- `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` (plural) function secrets exist, with no clear use in code. Are these leftover from earlier exploration? Do any functions read them?
- `apps/web/` exists with `vercel.json` — confirm whether the Vercel deployment is live (last deploy time, working URL) or dormant. Affects Phase 3.
- The pre-commit hook is broken (per earlier sessions). Confirm still broken so we know to use `--no-verify` for commits in later phases.

---

## Deliverable

A single markdown file: `MIGRATION_PHASE_0_AUDIT.md` at the repo root, with sections:

1. **Existing new keys** — count and metadata of publishable and secret keys already created
2. **Current function secrets** — full list, plus notes on `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` purposes (or lack thereof)
3. **Edge function env var usage** — table of which secrets each function reads
4. **Cron authentication mechanism** — exact pattern for each of the 4 cron functions, with file:line citations
5. **CLI version** — installed and latest, plus any version pins in the repo
6. **Migration docs summary** — key constraints from official Supabase docs, especially around cron and edge function auth with new keys
7. **Client SDK versions** — `@supabase/supabase-js` versions across apps
8. **Pre-existing concerns** — list (don't fix) of anything weird found during audit
9. **Open questions** — anything ambiguous that needs resolution before Phase 1

Keep the report tight. File:line citations for code claims. No more than ~3 pages of markdown.

---

## Out of scope

- Creating, updating, or deleting any keys or secrets
- Modifying any edge function code
- Updating any client config
- Disabling legacy keys
- Updating the Supabase CLI (audit only — note version, don't change)
- Writing any migration code

---

## Stop conditions

Halt and report (do not proceed) if any of these occur:

- The Supabase dashboard shows zero existing publishable/secret keys (we expected at least the ones the user created earlier)
- `supabase secrets list` shows that `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY` are missing (would indicate prior cleanup we didn't expect)
- The Supabase CLI is broken or unauthenticated
- Any cron migration file uses an authentication pattern other than `Authorization: Bearer <vault secret>` (e.g., uses a hardcoded key, no auth at all, or some other mechanism)
- The official Supabase docs explicitly state that `sb_secret_...` keys CAN be used as `Authorization: Bearer` tokens (this would contradict prior reads of the docs and we'd want to verify before proceeding)
