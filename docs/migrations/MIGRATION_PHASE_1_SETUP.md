# Supabase API Key Migration — Phase 1: Set Up New Keys Alongside Legacy

## Purpose

Set up the new `sb_publishable_...` and `sb_secret_...` keys as function secrets and local environment variables, **alongside** the existing legacy `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. No code changes. No removal of legacy keys. No disabling of anything.

After Phase 1: the new keys are available everywhere they need to be for Phase 2 to start using them. Until Phase 2 is run, nothing actually uses them — the system continues running on legacy keys as it does today.

This is the "safe foundation" phase. If anything goes wrong, no production behavior changes.

---

## Critical constraints

- **Do not modify any edge function code.** Not a single `Deno.env.get()` call changes in this phase.
- **Do not modify any migration files** (cron auth stays on legacy `service_role_key` from vault).
- **Do not modify any client code** (mobile app, web app, scripts continue using legacy keys).
- **Do not delete or update any existing function secrets.** Specifically: do NOT touch `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, or the orphaned `SUPABASE_PUBLISHABLE_KEYS`/`SUPABASE_SECRET_KEYS` (those will be cleaned up in Phase 5).
- **Do not click "Disable legacy API keys"** in the Supabase dashboard. That's Phase 4.
- **Do not deploy any edge functions** in this phase. No deploys at all.
- **Do not modify `supabase/config.toml`** — the `verify_jwt` flag changes happen in Phase 2.

---

## Tasks

### 1. Verify current state of new keys in Supabase dashboard

Open the Supabase dashboard → Settings → API Keys → "Publishable and secret API keys" tab.

Document what currently exists:
- How many `sb_publishable_...` keys exist? Note prefix (first 16 chars), name (if any), and creation date of each.
- How many `sb_secret_...` keys exist? Same metadata.

**Expected state:** at least one of each, created during exploration in a prior session. If there are zero, stop and report — we'd need to create them as a separate first step.

If there are existing keys, decide whether to use them or create fresh named ones:
- **Use existing:** acceptable if they were created intentionally and the user knows what they are
- **Create fresh, named keys:** preferred if existing keys are unlabeled exploratory leftovers

**Recommendation for this project:** Create three fresh named secret keys, one per logical caller, per Supabase's best practice: *"Prefer using a separate secret key for each separate backend component of your application."*

Specifically:
- `cron` — used by pg_cron jobs to invoke edge functions
- `edge-functions-internal` — used by edge function code internally for service-role DB operations
- `local-scripts` — used by the simulation harness and local dev scripts

And one publishable key:
- `default` (or use the existing one if already created)

**Stop here and ask the user** before creating these keys. The user may want different naming or a different scoping decision.

### 2. After user confirms key naming, create the keys in Supabase dashboard

Manual step (cannot be done via CLI — secret keys must be created in dashboard for security):

For each secret key the user approved:
1. Dashboard → Settings → API Keys → "Publishable and secret API keys" tab → "Create new secret key"
2. Name it per the user's confirmation (e.g., `cron`, `edge-functions-internal`, `local-scripts`)
3. Copy the value to a temporary scratch location (NOT a file that will be committed)
4. Note the prefix (first 16 chars) for the report

For the publishable key, similar process if creating fresh, otherwise note the existing one's value.

**Important:** Once created, secret key values can be revealed again in the dashboard, but treat them as if they cannot. Don't lose them mid-task.

### 3. Set new keys as Supabase function secrets (alongside existing)

In the terminal at repo root, set the new keys as function secrets. Use `supabase secrets set` with these names:

```bash
supabase secrets set SB_SECRET_KEY_CRON=<value>
supabase secrets set SB_SECRET_KEY_INTERNAL=<value>
supabase secrets set SB_PUBLISHABLE_KEY=<value>
```

(Adjust names if user chose different naming in step 1.)

The `SB_SECRET_KEY_LOCAL_SCRIPTS` value is NOT set as a function secret — that one is only used by local scripts and goes in `.env`, not function env.

**Do not delete or update the existing `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEYS`, or `SUPABASE_SECRET_KEYS` secrets.** They stay until Phase 5 cleanup.

**Verify:** Run `supabase secrets list` and confirm:
- The new `SB_SECRET_KEY_CRON`, `SB_SECRET_KEY_INTERNAL`, `SB_PUBLISHABLE_KEY` entries appear
- The legacy `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` entries are unchanged (compare digests against the prior `supabase secrets list` output if available)

### 4. Add new keys to local `.env` (alongside existing)

Open `./.env` in an editor. Add these new lines (do NOT remove existing `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY`):

```
# New API keys (Phase 1 — added alongside legacy, not yet used)
SB_PUBLISHABLE_KEY=<value>
SB_SECRET_KEY_LOCAL_SCRIPTS=<value>
```

Save. Verify with `cat .env | grep -E "(SUPABASE_|SB_)"` — should show 4 lines (2 legacy + 2 new), not 2.

### 5. Add new keys to `.claude/settings.local.json` (alongside existing)

Open `.claude/settings.local.json`. Add the new keys to whatever structure currently holds the legacy ones. Keep the legacy entries intact.

If the file structure is unclear, leave a TODO and report back rather than guessing — this file's format may not be well-documented and breaking it could affect Claude Code sessions.

### 6. Create a key inventory document

Create a new file: `docs/api-keys-inventory.md`

Content (template, fill in actuals):

```markdown
# API Keys Inventory

Last updated: <date>
Phase: 1 (new keys set up alongside legacy; nothing using them yet)

## Active legacy keys (still in use)

| Key | Type | Used by | Status |
|-----|------|---------|--------|
| Legacy `anon` | JWT | mobile app, web app, edge functions (anon flows), local scripts | ACTIVE |
| Legacy `service_role` | JWT | cron (via vault), edge functions (admin flows), local scripts | ACTIVE |

## New keys (provisioned, not yet in use)

| Key | Type | Will be used by | Status | First 16 chars |
|-----|------|-----------------|--------|----------------|
| `cron` | sb_secret | pg_cron jobs (Phase 2) | PROVISIONED | sb_secret_xxxxxx |
| `edge-functions-internal` | sb_secret | Edge functions for admin DB ops (Phase 2) | PROVISIONED | sb_secret_xxxxxx |
| `local-scripts` | sb_secret | Simulation harness, local dev scripts (Phase 3) | PROVISIONED | sb_secret_xxxxxx |
| `default` | sb_publishable | Mobile app, web app, edge function anon flows (Phase 3) | PROVISIONED | sb_publishable_xxxxxx |

## Where each key lives

| Location | Legacy keys | New keys |
|----------|-------------|----------|
| Supabase function secrets | SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY | SB_SECRET_KEY_CRON, SB_SECRET_KEY_INTERNAL, SB_PUBLISHABLE_KEY |
| Local `.env` | SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY | SB_PUBLISHABLE_KEY, SB_SECRET_KEY_LOCAL_SCRIPTS |
| Mobile `apps/mobile/.env` | EXPO_PUBLIC_SUPABASE_ANON_KEY | (Phase 3) |
| Mobile `eas.json` | @EXPO_PUBLIC_SUPABASE_ANON_KEY (placeholder) | (Phase 3) |
| Web `apps/web/.env.local` | VITE_SUPABASE_ANON_KEY | (Phase 3) |
| Vercel env (if live) | VITE_SUPABASE_ANON_KEY | (Phase 3) |
| Supabase Vault (cron) | service_role_key | (Phase 2) |
| `.claude/settings.local.json` | legacy values | new values added |
```

Fill in the actual prefix values and date. **Do NOT include full key values anywhere in this file.** Only first 16 chars for identification.

### 7. Verify nothing has broken

Sanity checks (no smoke tests needed — we haven't changed anything functional):

- Run `supabase secrets list` and confirm legacy secrets still show their original digests
- Run `cat .env | grep "SUPABASE_SERVICE_ROLE_KEY"` and confirm legacy is still present and unchanged
- Run `git status` to see what files changed (should be: `.env`, `.claude/settings.local.json`, `docs/api-keys-inventory.md`)

---

## Deliverable

A single markdown file: `MIGRATION_PHASE_1_REPORT.md` at the repo root, with sections:

1. **Existing keys found in dashboard (task 1)** — what was already there before this phase
2. **Keys created in this phase (task 2)** — names, prefixes, creation timestamps
3. **Function secrets set (task 3)** — names of new secrets, confirmation legacy unchanged
4. **`.env` updates (task 4)** — confirmation of new lines added
5. **`.claude/settings.local.json` updates (task 5)** — confirmation, or TODO if structure unclear
6. **Inventory doc created (task 6)** — confirmation file exists at expected path
7. **Verification results (task 7)** — output of sanity checks
8. **Files changed** — `git status` output, plus note that nothing should be committed yet (Phase 2 will bundle commits)
9. **Concerns or anomalies** — anything unexpected

---

## Out of scope

- Modifying any edge function code (Phase 2)
- Modifying any cron migrations (Phase 2)
- Modifying any client code (Phase 3)
- Deleting any legacy keys or function secrets (Phase 5)
- Disabling legacy keys in the Supabase dashboard (Phase 4)
- Updating the Supabase CLI (separate decision before Phase 2)
- Touching `SUPABASE_PUBLISHABLE_KEYS` or `SUPABASE_SECRET_KEYS` orphaned secrets (Phase 5)
- Touching `ALPACA_KEY_ID` or `ALPACA_SECRET_KEY` orphaned aliases (Phase 5)
- Committing changes (will be batched with Phase 2 commit)

---

## Stop conditions

Halt and report (do not proceed) if any of these occur:

- Zero `sb_publishable_...` or `sb_secret_...` keys exist in the dashboard, AND the user has not confirmed naming for fresh keys
- `supabase secrets set` fails for any reason
- The legacy `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY` function secret digests change (would indicate accidental update — these must remain identical for the system to keep working)
- The `.env` file already contains `SB_PUBLISHABLE_KEY` or `SB_SECRET_KEY_LOCAL_SCRIPTS` with different values (would indicate prior partial migration)
- The user is unreachable for the step 1 confirmation about key naming/scoping
