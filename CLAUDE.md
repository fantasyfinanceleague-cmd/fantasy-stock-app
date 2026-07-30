<!-- Append this section to your existing CLAUDE.md (or create one at repo root). -->

## Subagent roster & delegation rules

This repo defines project-scoped subagents in `.claude/agents/`. They exist to keep the main session's context clean and to enforce the prod/secret handoff model structurally.

**The rule that governs all of them:** no subagent runs prod-mutating commands — enforced structurally, not by prose. **All five agents have NO Bash in their `tools:`**, so they are physically incapable of running any shell command (`supabase db push`, edge-function deploys, real-key curls, vault rotations, `git push`/`merge`). They draft files and flag; applying anything is Giorgio's alone. A second layer in `.claude/settings.json` governs the *main* session (and any future Bash-capable agent): it puts every prod-mutating command on the `ask` tier — `supabase db push`/`functions deploy`/`secrets set` (and their `npx` forms), Vercel deploys, and `git push`/`git merge` — so each one prompts for confirmation before running rather than being hard-denied. This is a deliberate autonomy choice: nothing is blocked outright (a hard `deny` can't be overridden in-session), but no prod-mutating command runs without an explicit human OK. Read-only/branch work runs freely.

| Agent | Model | Tools | Purpose |
|---|---|---|---|
| `explorer` | haiku | Read, Grep, Glob | Read-only recon across the monorepo. Cheap, fast, keeps context clean. |
| `security-reviewer` | sonnet | Read, Grep, Glob | Flags secret exposure, auth gaps, injection, blast-radius violations. Read-only by design. |
| `supabase-reviewer` | sonnet | Read, Grep, Glob | Reviews migrations, RLS, edge functions, cron/vault SQL. Ends with explicit HUMAN ACTION handoffs. |
| `supabase-migration-writer` | sonnet | Read, Write, Edit, Grep, Glob | Drafts migrations + RLS SQL to `supabase/migrations/` on a branch; never applies. Ends with explicit HUMAN ACTION `db push` handoffs. |
| `test-writer` | sonnet | Read, Write, Edit, Grep, Glob | Drafts tests on a branch (no shell — doesn't run them); hands back the exact test command. Reports source bugs rather than patching. |

**Secret handling:** if any subagent surfaces a real key VALUE (not a variable name), it must report the location and type and mark it for rotation — never reproduce the value. Even test exposure requires rotation.

**Reminder:** subagents load at session start. If you edit a file in `.claude/agents/` on disk, restart the session (or use `/agents` to edit, which takes effect immediately).

## Model selection (orchestrator)

The session model is the orchestrator; each subagent runs on the `model:` in its own frontmatter (Haiku for `explorer`, Sonnet for the reviewers and the two writers), regardless of the session model. Switch the session model with `/model <alias>`; `/status` shows the active one.

**Default: Opus 4.8.** Use it for essentially all current work — the API-key migration, Phase 3b Vercel cutover, secret-scanner setup, cron/vault/RLS review, and anything reviewer-driven. Two reasons it's the right default here, not just a budget choice:
- This work is security-heavy (secrets, key rotation, constant-time guards, blast-radius isolation). Fable 5's classifiers reroute cybersecurity-adjacent requests to Opus 4.8 anyway, and can fire on the first message from CLAUDE.md + git status alone. On this repo, Fable would frequently just become Opus — at double the cost.
- The migration/review work needs correctness and careful tool scoping, not frontier reasoning. Opus 4.8 covers it fully.

**Reach for Fable 5 (`/model fable`, session-only) only when ALL of these hold:**
- The task is large and long-horizon — work you'd normally break into pieces (e.g. the mobile Home-screen architectural rebuild in `STOCKPILE_UI_OVERHAUL.md`).
- It is NOT security/secrets/cron/key-adjacent (or the classifier will reroute it and the cost is wasted).
- You've accepted the cost: Fable is ~$10/$50 per M tokens (≈2× Opus) and, as orchestrator, sits in the token-heavy coordinating role.

**Guardrails when using Fable 5:**
- Switch session-only, not as default, so a later security session doesn't silently run at 2× credits.
- Confirm with `/status` before starting major work.
- Check current plan terms — Fable's subscription inclusion window has passed; on Pro/Max it now draws usage credits at the higher rate.
- Leave the `/config` "switch models when a message is flagged" reroute ON. For this repo the reroute is a feature, not a bug — it keeps security-adjacent requests on Opus.

Rule of thumb: **Opus by default; Fable only for the big, non-security refactors, and only session-scoped.**

## Operational conventions

**Workspace directories (monorepo — run commands from the right place):**
- **EAS/Expo** commands run from `apps/mobile/`, never repo root. Running from root offers to create a *duplicate* project — never accept that prompt.
- **Vite/web** commands (`npm run dev`, etc.) run from `apps/web/`, not repo root.
- **Deno is now a LOCAL-DEV toolchain requirement, not just the Supabase edge runtime.** `supabase/functions/process-week-results/grouping.test.ts` is a hermetic unit test run with `deno test supabase/functions/process-week-results/grouping.test.ts` from repo root — contributors and CI need Deno installed to run it. It needs no DB, no secrets, and no `--allow-*` flags (first run fetches `jsr:@std/assert` into the Deno cache). `deno.lock` is committed to pin that version; it also tracks the npm workspace deps, so it can churn when `package.json` changes.

**Supabase / deploys (verify state, never trust the command's own output):**
- `supabase db push --dry-run` only PREVIEWS — the real `supabase db push` must follow. After any cron/migration change, confirm with a follow-up query (e.g. `SELECT command FROM cron.job WHERE jobname = '<job>';`), not just the push output.
- A `verify_jwt` true→false flip may not take on first deploy. Confirm it took with a no-credential request that reaches OUR code (not the gateway's generic 401), plus the dashboard Verify-JWT toggle.
- **Merging to `main` auto-deploys the web app to Vercel production** — treat a merge as a prod deploy. Add/rename any required Vercel env vars BEFORE merging.

**Postgres function grants (Supabase — locking down SECURITY DEFINER / RPC functions):**
- **`REVOKE ... FROM PUBLIC` does NOT remove Supabase's default per-role grants.** Supabase runs `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role`, so **every** function is born with explicit `anon=X` / `authenticated=X` grants **separate from** the built-in `PUBLIC=X`. `REVOKE FROM PUBLIC` clears only the `PUBLIC` entry — the explicit `anon`/`authenticated` grants survive, leaving the function still callable. To actually lock a function down you MUST explicitly `REVOKE ... FROM anon` (and `FROM authenticated` where it's service-role-only). **Verify with the `proacl` query, never assume revoke-from-public closed it.** This bit us hard: `start_new_league_season` was anon-callable destructive-DELETE, and `join_league_by_code` was authenticated-callable with a forge-able `p_user_id` — both "locked down" with revoke-from-public that did nothing. `CREATE OR REPLACE FUNCTION` also does NOT reset privileges. Proacl check: `SELECT proname, proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname='<fn>';`

**Git (commit hygiene):**
- **Run `git status` before EVERY commit.** `git add <file>` does NOT scope the commit — the *index* does. Anything already staged (a rename, a file left in the index from a prior session, another agent's work) rides along even if you only `git add`ed one path. This bit us: a pre-staged `docs/ → supabase/migrations/` rename of a deliberately-held file got swept into an unrelated feature commit, landing it in the `db push` apply path. Before committing, inspect `git status` and `git diff --cached --stat`, and confirm the staged set is EXACTLY what you intend — nothing more.
- **In worktrees, `git status` clean does NOT mean HEAD is attached to the intended branch** — a detached HEAD shows clean status, and a ref-advancing op (merge/commit/rebase) there builds on a nameless ref while the branch stays behind. Before any merge/commit/rebase in a worktree, verify attachment with `git branch --show-current` (empty = detached), not just cleanliness. These worktrees detach as a housekeeping artifact.

**UI entry points (mobile):**
- **Verify a UI entry point is both MOUNTED and REACHABLE in the state that matters — not just that the file exists.** Check: is the host visible in the tab bar, and is the element outside any `length === 0` (empty-state) branch? This bit us three times in one wave — `LeagueCarousel.tsx` orphaned (never imported/mounted), `leagues.tsx` `href: null` + only linked from zero-league empty states, and nearly again on `league.tsx`. Grep who navigates to the host screen and under what condition BEFORE adding or citing a button.

**Guards here are keyed on ALL-OR-NOTHING state and blind to PARTIAL state. Check the partial case first.** This is the most recurring design flaw in this codebase — **five instances found, all five now fixed**. Note it is no longer confined to the scoring/snapshot pipeline: instance 5 appeared in the auditing tool built to catch the other four:
1. **FIXED (`2caf9f8`) — `snapshot-week-start`'s old existence-only skip.** ANY snapshot row for a league-week meant "done", so a partial write (a user whose only symbol lacked a price got zero rows) read as complete and was *permanently unhealable*: every retry skipped the league. Replaced with per-participant completeness.
2. **FIXED — `process-week-results`' batch guards** keyed off `hasSnapshots`, true if ANYONE in the league-week had a row. In a partially-snapshotted week > 1 a snapshot-less user still reached the cumulative-from-entry fallback. Fixed by adding the per-user gate (`decideUserScorer` / `decideMatchupScoring`) — note the fix was to add a *per-participant* check, not to tighten the batch one.
3. **FIXED (`bc239a5`, merged `85d3bb9`) — `snapshot-week-end`'s `alreadyProcessed`.** ANY row carrying a `week_end_price` skipped the whole league, so a partial week-end write could not be healed and its retry no-opped rather than repairing — which also made the `schedule_snapshot_retry` fix ineffective for this function specifically. Replaced with the per-participant coverage gate in `close.ts` (22 hermetic tests). Note `close.ts` is deliberately NOT symmetrical with `snapshot-week-start/plan.ts`: week-end has TWO write paths (close an existing Monday row; insert a mid-week buy), so "missing" has two kinds and completeness is the conjunction of both.
4. **FIXED (`cc26857`) — mid-week purchases.** A user whose ENTIRE week was mid-week buys had no snapshot rows, so they were `unscoreable` and the matchup correctly refused; a user with SOME mid-week buys was silently scored on a subset of their portfolio. Total case guarded, partial case wrong — the signature of this whole family. Fixed by the `entered_mid_week` discriminator (see the NULL entry below).
5. **FIXED (`dfa442d`) — the architecture map's own RLS grading.** `gen-architecture.mjs` computed its ungated-predicate check as `publicRolePolicies.filter(...)` — over the PUBLIC-role subset only — and wrapped the whole block in `if (publicRolePolicies.length)`. So it derived a **table-wide** "all gated on caller identity" claim from a **partial** view of the table's policies. When `20260728000001` moved `user_profiles`' SELECT from PUBLIC to `authenticated`, that policy left the examined set; the two remaining PUBLIC write policies genuinely do gate on `auth.uid() = id`, so the table fell to the all-gated branch. Fixed by partitioning ungated policies by *audience* instead of filtering by it, and guarding on `live.policies.length`.

   **Two things make this instance distinctive, and both are the reason it is worth remembering over the other four:**
   - **It appeared inside the tool built to catch this class.** The drift panel exists to compare what migrations CLAIM against what prod HAS. Its own grader had the exact defect it was auditing for, which means a clean panel was never evidence the panel could see the thing it was pointed at. An auditing tool is not exempt from the failure mode it audits.
   - **It failed as an affirmative clearance, not as silence.** The row did not go missing; it went LOW and read *"Cosmetic inconsistency, **not an exposure**"* about a table whose SELECT is `USING (true)` over a column holding a bearer capability. A missing row invites a question. A row that says "not an exposure" closes one. Prefer a heuristic that reports *"I only examined N of M policies"* over one that generalises from the subset — and when a guard emits a verdict, make sure the verdict's SCOPE matches the evidence's scope.

   **The latent case it hid, which is worse than the instance:** a table whose policies were ALL `authenticated` and ALL ungated produced **no drift row whatsoever** — `publicRolePolicies.length` was 0, so the block never ran. `user_profiles` stayed visible only by accident, because it still had two PUBLIC write policies. Normalising those to `authenticated` — the obvious next tidy-up, and one the LOW row explicitly recommended — would have made the table vanish from the panel entirely. So the tool's advice would have destroyed its own visibility.

The pattern: `.some()`, `EXISTS`, `filter()`-then-conclude, and "is there any row?" are almost always the wrong predicate over a set that can be partially filled. **Compare a count against the expected set, per participant** — and when a guard refuses, make sure the refusal is *recoverable*, because in cases 1–4 the all-or-nothing read turned a recoverable gap into a permanent one. Case 5 adds a second rule for anything that emits a JUDGEMENT rather than a write: **the scope of the verdict must match the scope of the evidence.** If you filtered the set before concluding, say what you filtered out — a subset-derived claim stated as a whole-object claim is the same bug wearing a different hat, and it is more dangerous because it reads as clearance.

**Overloaded NULLs are type tags, and you cannot fill them in.** RESOLVED in `cc26857` — kept here because the reasoning generalises and the wrong repair was very nearly taken.

*What happened:* `week_snapshots.week_start_price` is `NOT NULL`, yet `snapshot-week-end` inserted NULL into it for mid-week purchases — so that insert failed on **every run from 2026-01-15 until 2026-07-27**, and those positions were silently dropped from scoring (not just a missing row: `calculateUserScore` drops a mid-week buy with no end price from BOTH `totalGain` and `totalStartValue`, so the dollar gain omitted it and the percent gain was computed over a basis that excluded it).

*Why the obvious repairs were both wrong.* Writing the purchase price to satisfy `NOT NULL` would have **double-counted**: two scorer paths branched on `weekStartPrice !== null` / `=== null`, so the row would have settled as a Monday holding while the same buy settled again from the trades list. Making the column nullable would have preserved the overloaded NULL permanently, kept the playoff both-empty defect coupled to the change, and introduced a UI bug — three screens multiply `quantity * week_start_price` for cost basis with no null filter, so `Number(null) → 0` would render avg entry `$0.00` and a "gain" equal to the position's whole market value.

*How it was resolved:* an explicit `entered_mid_week` boolean column, **not** a nullability change. `week_start_price` now always carries a real entry price (a Monday open, or a weighted-average purchase price), both scorers key on the flag, and the three UI surfaces needed no change at all — they compute `(currentPrice − entryPrice) × quantity`, which is correct for either row kind.

*The transferable rule:* a NULL that something tests for is a **discriminator, not a missing value**. Before "filling in" a NULL, grep for every `=== null` / `!== null` test on that column. If any exist, the NULL is load-bearing, and the fix is an explicit discriminator column — not a value, and not a nullability change.

**Success signals in this codebase are unreliable by default — verify the EFFECT, not the status.** Six instances found so far, all the same shape, which makes it systemic rather than incidental:
1. **`isMarketOpenToday` returns `open:false` on a 401**, so a stale Alpaca key logs "market closed" and the run exits cleanly having done nothing.
2. **`net.http_post` is asynchronous**, so `cron.job_run_details` reports `succeeded` on *enqueue* regardless of the HTTP response. A job posting to a `verify_jwt=true` function with no auth header 401s forever and still logs success every run. Use `net._http_response` (≈6h TTL), or check whether the target data changed.
3. **`schedule_snapshot_retry` raised before its own status `INSERT`.** The `INSERT ... 'retrying'` sat after the `PERFORM cron.schedule(...)`, and a PL/pgSQL body is atomic, so a failed retry-schedule rolled back its own evidence. `cron_job_status` had zero `retrying` rows for the function's entire life — which read as "no retries needed", not "retries never worked".
4. **`process-week-results` reports success while returning refused batches in `skipped[]`.** A 200 with `processed: 0` is a normal-looking response for a week that scored nothing.
5. **`supabase-js` `.rpc()` does NOT throw on a Postgres error** — it resolves to `{ data, error }`. A `try/catch` around it catches only transport failures. Both `scheduleRetry` callers discarded the result and then logged `"Scheduled retry N"` unconditionally, asserting success on every call while nothing was ever scheduled. **Always destructure and check `error`;** a wrapping `try/catch` is not a substitute.
6. **`process-week-results` strands `cron_job_status` at `'running'` forever on its most common path.** It writes `'running'` at `index.ts:851`, but terminal statuses exist at only two places — `'success'` at `:1463` and `'failed'` at `:1477`. Two returns sit in between and write neither: `:890` (no pending matchups, HTTP 200) and `:885` (the matchup query itself failed, HTTP 500). Observed on five consecutive Fridays, all left at `'running'`.

**#6 is structurally the worst of the six, and it is worth understanding why.** The other five emit a *wrong* signal — a false success, a misleading status, a fabricated log line. Those are detectable: you can compare the signal against the effect and catch the lie. #6 emits a signal that **can never reach a terminal state in the common case**. A stranded `'running'` row is byte-identical whether the function hung, crashed mid-run, or completed normally with nothing to do. So an alert on "job stuck in running" fires every single week and gets muted, and an alert on "job never reported success" also fires every week. The monitoring signal cannot fire *correctly* rather than merely firing *wrongly* — there is no threshold that separates the healthy case from the broken one, because they are the same row.

**On the five Fridays specifically: scoring was NOT broken.** `unscored` was confirmed 0 across every league — no matchups with `team1_gain IS NULL` and `week_end < now()`. `:890` firing weekly is the function correctly reporting there is nothing to score. The finding is the stranded status row and nothing else. Do not read those five rows as five missed scoring runs.

Before concluding a job worked, query the data it should have written. Absence of failures is not evidence of success — and a success *log* is not evidence either, since #5 fabricated one, nor is a *missing* terminal status evidence of failure, since #6 omits one routinely.

**Corollary — PL/pgSQL defers name resolution to execution time.** A call to a function signature that does not exist creates cleanly and only raises when that line runs. `schedule_snapshot_retry` passed a `TIMESTAMPTZ` to `cron.schedule` (which has no such overload; implicit datetime→text casts were removed in PG 8.3) and survived three migrations looking healthy. A migration applying successfully says nothing about whether its function bodies work. Exercise the path, or check `pg_proc` overloads directly.

**Architecture map (`docs/architecture/`):**
- **After changing `supabase/functions/`, `supabase/migrations/`, `supabase/config.toml`, or any client call site (`functions.invoke` / `.rpc` / `.from`), run `node scripts/gen-architecture.mjs` and commit the result.** `node scripts/gen-architecture.mjs --check` exits 1 with a `+`/`-` diff of exactly which call sites moved.
- **NEVER hand-edit `architecture.json` or `architecture.html`** — both are generated and your edits are silently overwritten on the next run. Prose goes in `annotations.json`, keyed by node/edge/flow id; the generator merges it and never overwrites it. The viewer's markup lives in `scripts/architecture-viewer.html` (the template), not the generated HTML.
- **`db-snapshot.json` is hand-refreshed and goes stale.** It carries the facts no file can know — function ACLs, `search_path` pins, RLS policy names, cron jobs. Re-capture by running `docs/architecture/db-snapshot.sql` against prod and saving the single output cell. The viewer turns the age badge red past 14 days. Refresh it after ANY grant, RLS, or cron change — those are exactly the changes a migration can claim and fail to make.
- **The `drift` block is the point of the map, not a side effect.** It is the only place that compares what migrations CLAIM against what prod HAS. Given that `REVOKE ... FROM PUBLIC` does not clear Supabase's default `anon`/`authenticated` grants and `CREATE OR REPLACE FUNCTION` does not reset privileges, a lockdown migration is never evidence of a lockdown. Check the "Claim vs reality" panel after any security migration.
- If the generator refuses to build with a key-shaped literal in `cron.job.command`, that is a real exposure: **rotate the key first**, then reschedule the job to read from `vault.decrypted_secrets`, then re-capture. Do not delete the match to get past the check.

**General:** after a dry-run or any state change, verify the ACTUAL state (grep / `git status` / a query) before building on it. Don't assume a command did what its output implied.

**Cross-table position queries need explicit casts.** `drafts.user_id` is `text` and `trades.user_id` is `uuid`, and the quantity columns differ in numeric type — so any `UNION ALL` over drafts+trades fails without `::text` on the user ids and `::numeric` on the quantities. Both the week-start and week-end coverage audits hit this.
