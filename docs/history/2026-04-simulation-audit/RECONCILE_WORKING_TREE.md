# Reconcile Working Tree With Deployed State

## Purpose

The simulation audit (`SIMULATION_AUDIT_REPORT.md`) revealed that critical fixes are deployed to production Supabase but **not committed to git**. This includes:

- The `processedWeeks` loop fix in `supabase/functions/process-week-results/index.ts`
- The `league_id` request filtering logic in the same file
- The `season_status = 'playoffs'` transition logic
- The migration `supabase/migrations/20260305000000_add_playoffs_season_status.sql`
- Possibly other untracked or uncommitted changes

This means a `git stash`, `git checkout`, `git reset --hard`, or fresh clone would either destroy the fix locally or — if redeployed from git — break production. Additionally, `PLAYOFF_TRANSITION_FIX.md` describes a fix that has already been applied, which is misleading.

**Goal:** Bring git into alignment with deployed state, so the repo accurately represents what is running in production. After this task, `git diff HEAD` against the deployed function should show no functional differences.

---

## Critical constraints

- **Do not modify edge function logic.** This task is about committing existing changes, not changing them. The deployed code is working; do not "improve" it during this pass.
- **Do not redeploy any edge function or migration.** The deployed state is the source of truth. We are syncing git **to** deployment, not the other way around.
- **Do not delete uncommitted changes** without first verifying they are committed. A `git stash` followed by an error would lose the fix.
- **Do not run the simulation test runner during this task.** It hits production. Save it for the final verification step.
- If at any point you are unsure whether a change is safe to commit, **stop and report rather than proceed**.

---

## Tasks

### 1. Inventory the working tree

Before committing anything, produce a complete inventory of what is uncommitted. Run:

```bash
git status
git diff HEAD --stat
git diff HEAD --name-only
```

For every modified, added, or untracked file, classify it into one of these categories:

- **A. Sync to deployed (commit as-is):** files where the working copy matches deployed production state and should be committed verbatim. Includes the `process-week-results` fix, the playoffs migration, and any related changes.
- **B. Local-only work in progress:** files that are mid-edit and not yet deployed. Should NOT be committed in this task — leave them in the working tree.
- **C. Unrelated changes:** files modified for reasons unrelated to the deployed fix (e.g., UI work, debug logging, scratch files). Should NOT be committed in this task.
- **D. Untracked files that should be `.gitignore`d:** logs, build artifacts, `.env` files, etc. Should be added to `.gitignore`, not committed.
- **E. Unclear:** anything where category is ambiguous.

Output a markdown table with columns: `file`, `category`, `reason`. For category E, stop the task and ask before proceeding.

### 2. Verify deployed-vs-working-copy alignment

For files in category A, confirm the working copy actually matches what is deployed. The audit report stated this is the case for `process-week-results/index.ts`, but verify before committing:

- For `supabase/functions/process-week-results/index.ts`: use the Supabase CLI or dashboard to confirm the deployed function source matches the local working copy. If the CLI cannot retrieve deployed source, document that limitation and proceed based on the audit's evidence (the simulation passes, which requires the working copy logic to be deployed).
- For the migration `20260305000000_add_playoffs_season_status.sql`: confirm the migration has been applied to the production database. Check `supabase_migrations.schema_migrations` (or the equivalent system table) for the migration version. If applied, it is safe to commit. If not applied, **stop and report** — committing a migration that isn't applied is a different (and riskier) situation.

### 3. Stage and commit category A changes

Commit category A files using **logical, atomic commits**, not one giant commit. Suggested grouping:

- **Commit 1:** The migration file `20260305000000_add_playoffs_season_status.sql` alone, with message describing the schema change.
- **Commit 2:** The `process-week-results/index.ts` changes (loop fix, league_id filtering, phase transition logic), with a message describing the bug it fixed and referencing `PLAYOFF_TRANSITION_FIX.md`.
- **Commit 3+:** Any other category A files, grouped sensibly.

Each commit message should follow this rough shape:

```
<type>: <short description>

This change was previously deployed to production Supabase but never
committed to git. This commit syncs the repository with the deployed
state. No functional change.

Reconciles: <issue or doc reference>
```

Do **not** force-push, rebase, or rewrite history. Append commits to the current branch.

### 4. Reconcile `PLAYOFF_TRANSITION_FIX.md`

This document currently reads as a to-do for a fix that has already been applied. Two acceptable resolutions:

- **Option 1 (preferred):** Convert it to a historical record. Rename to `docs/fixes/2026-03-PLAYOFF_TRANSITION_FIX.md` (or similar archival path). Add a header at the top: `# RESOLVED — Applied <date>, committed <commit SHA>`. Leave the body intact as a record of the bug and fix.
- **Option 2:** Delete the file entirely. Acceptable if the commit message in task 3 captures the bug context adequately.

Pick option 1 unless there's a reason not to. Commit this change separately from task 3.

### 5. Audit `.gitignore` for category D files

For any category D files (logs, build artifacts, env files, sim test logs), add appropriate entries to `.gitignore`. Specifically check for:

- `logs/` directory (sim test logs go here)
- `*.log` files at the repo root
- `.env`, `.env.local`, etc. (verify these aren't already tracked — if they are, that's a separate security issue to flag)
- Any Supabase CLI cache or local dev artifacts (`supabase/.temp/`, `supabase/.branches/`, etc.)

Commit `.gitignore` changes separately.

### 6. Final verification

After all commits:

- `git status` should show a clean working tree EXCEPT for category B (in-progress) and C (unrelated) files.
- `git log --oneline -10` should show the new commits in a sensible order.
- Run `git diff HEAD~N HEAD` (where N is the number of new commits) to review the total set of changes being committed. Eyeball for anything unexpected.
- Do **not** run the simulation. Verification of deployed-vs-git alignment is by inspection in this task.

---

## Deliverable

A single markdown file: `RECONCILIATION_REPORT.md` at the repo root, containing:

1. **Inventory table** from task 1
2. **Alignment verification results** from task 2 (deployed function source check, migration applied check)
3. **Commits made** — list of commit SHAs and messages
4. **`PLAYOFF_TRANSITION_FIX.md` resolution** — which option was chosen and why
5. **`.gitignore` changes** — what was added
6. **Remaining uncommitted files** — anything in categories B and C still in the working tree, with a one-line note on each so future-you knows what they are
7. **Concerns or anomalies** — anything unexpected encountered during the task, especially any case where deployed state could not be verified

---

## Out of scope

- Running the simulation test runner
- Fixing the assertion gap in the simulation (separate spec, next task)
- Any changes to edge function logic
- Setting up a separate Supabase project for testing
- Addressing the `auth.users` cleanup concern from the audit

---

## Stop conditions

Halt and report to the user (do not proceed) if any of these occur:

- A category A file's working copy does not match deployed state
- The playoffs migration appears not to have been applied to production
- `git status` reveals untracked changes that look security-sensitive (`.env` files with real secrets, key files, etc.)
- Any commit fails or produces unexpected diff output
- The category E pile is non-empty after task 1
