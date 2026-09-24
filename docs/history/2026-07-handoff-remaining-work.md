# Handoff — remaining work

**Base:** `main` @ `2092f4c` (verify with `git log --oneline -1 main` before branching; do not trust this SHA)
**Mode:** work autonomously. Batch your questions; do not stop after every step.

---

## How to work through this

There are six items. Four you can drive end to end with no input from me. Two are blocked on a decision that is mine to make, not yours.

The bottleneck is not permission — it is that **you have no database access and cannot push to prod**. Every SQL query has to come back through me, and `supabase db push` / `functions deploy` / `git push` are mine. So the way to move fast is not to ask for more permission per step, it is to **batch the times you need me**.

Work in this order:

1. **Read this whole file, then send me ONE message** containing: every SQL query you need answered, and the decisions you need from me (see §A and §B). Do not send them one at a time.
2. **While waiting, start item 6** — it needs neither.
3. When I answer, work through the rest **without checking in between items**. Commit each on its own branch.
4. **Report once at the end** with a table: branch, what it does, merge status, and what I need to run.

Ask again mid-stream only if something you find contradicts this document. Finding that is a good outcome, not a failure — several items below are written from a snapshot that may have moved.

---

## Standing rules

These are not new; they are the ones that cost us time tonight.

- **State main-vs-branch on every commit report.** "Committed on `main`" or "committed on branch X, awaiting merge." Two branches were reported as done tonight while sitting unmerged.
- **Verify actual state; do not trust command output.** `git branch --contains <sha>` to check whether something landed. Re-query rather than trusting a migration's text.
- **Before staging any file after a conflict:** `git grep -n -E '^(<{7}|={7}|>{7})$' -- <file>`. Committed conflict markers reached `main` tonight because `git add` marks a conflicted file resolved whether or not markers remain.
- **In a worktree, `git status` clean ≠ HEAD attached.** Check `git branch --show-current`; empty means detached.
- **`deno check <path>` works** — no flag needed since `deno.json` landed. Typecheck before committing. It caught two real regressions tonight after being written off as unavailable.
- **Run `deno test supabase/functions/process-week-results/` before any commit touching that function.**
- **After changing `supabase/functions/`, `supabase/migrations/`, `supabase/config.toml`, or any client call site:** run `node scripts/gen-architecture.mjs` and commit the result. Prose goes in `annotations.json`, never in the generated files.
- **Do not route around a classifier block.** Report it and hand it to me, as you did with `git push`.
- **One branch per item.** Do not stack unrelated changes.

---

## Subagents and skills

Do not leave these to judgement — over a long session tonight you dispatched `test-writer` once and the security reviewers barely at all, across a night of grant audits and RLS predicate work. They are assigned per item below.

**First, enumerate what actually exists** rather than trusting the list here: read `.claude/agents/`, check `.claude/settings.json` for slash commands and permission tiers, and look for any skills directory. Report the real roster back in your first message. The list below is from memory and may be stale — carry the query, not the answer.

The roster as I have it:

| Agent | Scope |
|---|---|
| `explorer` | Haiku, read-only recon |
| `security-reviewer` | Sonnet, read-only |
| `supabase-reviewer` | Sonnet, read-only, explicit HUMAN ACTION handoffs |
| `test-writer` | Sonnet, write-scoped to test files |
| `supabase-migration-writer` | drafts migrations |

Plus a `/migration-gate` slash command — confirm what it checks when you enumerate, and run every migration through it before it reaches me.

**Two constraints that shape how you use them:**

- **Subagents have no Bash.** `test-writer` writes tests; it cannot run them. You run `deno test` and `deno check` yourself and report the result. Do not report a test as passing on a subagent's say-so.
- **Run reviewers synchronously, not backgrounded.** A review agent was torn down mid-run tonight and returned no verdict at all. A blocking run is better than an async one whose absence is invisible.

**Per item:**

| Item | Use |
|---|---|
| 1, 2, 3 — RLS policy decisions | `security-reviewer` on the predicates before you recommend; `supabase-migration-writer` for whichever migration I approve |
| 4 — `refresh_symbols_daily` | `supabase-migration-writer` to draft the reschedule, `supabase-reviewer` on it |
| 5 — `verify_jwt` | `security-reviewer` on the eight findings; `explorer` to confirm `get-broker-keys` has no caller |
| 6 — `snapshot-week-end` | `explorer` first to read the `snapshot-week-start` pattern; `test-writer` for the hermetic tests |

If an agent's actual scope contradicts what I have assigned it, say so and use the right one.

---

## §A — SQL I need to run for you

Collect everything you need into one block. At minimum you will want the current state of the three tables in items 1–3, since the snapshot in `db-snapshot.json` is from `2026-07-28T05:49Z` and I may have changed something. Write the queries; I will paste results back.

## §B — Decisions I need to make

Items 1, 2 and 3 are product calls. For each, give me:

- what the options are,
- what each costs (files touched, what breaks, what has to change downstream),
- **your recommendation and why.**

Do not implement any of them until I answer. Do not assume the safest option is the right one — item 3 is probably fine as-is and item 1 probably is not.

---

## The six items

### 1. `notification_log` — unauthenticated unbounded write · HIGH

Policy `"Service role can insert notifications"`, role `PUBLIC`, `WITH CHECK true`. The name claims service-role-only; the predicate enforces nothing, so anyone with the publishable key can insert arbitrary rows.

Compounding: it is one of the zero-edge tables in the architecture map — nothing in the codebase reads or writes it. A possibly-dead table that anyone can write to unbounded, where nobody would notice rows arriving and nothing depends on them being real.

**Decision:** drop the table, or keep it and give the policy a real predicate. Check first whether anything writes it that the grep cannot see — a plpgsql body, an edge function, a client path. Note `apps/mobile/lib/notifications.ts` exists and has outbound edges, none of which touch this table.

### 2. `user_profiles` ↔ `get_real_user_ids` — inconsistent exposure · HIGH

`user_profiles` has policy `"Anyone can view profiles"`, role `PUBLIC`, `USING true` — anon reads every profile row.

Meanwhile migration `20260724000000` revoked anon from `get_real_user_ids`, a function whose entire output is *which of these UUIDs are real users*. If the whole profile table is anon-readable, that revoke bought nothing.

**Decision:** one call covering both. Either profiles are public — in which case say so explicitly and note that the `get_real_user_ids` revoke is belt-and-braces — or they are not, and the policy needs to gate. Do not resolve one without the other.

Tell me what breaks if profiles stop being anon-readable: which screens, which pre-auth flows, whether the landing page or the join-by-code preview depend on it.

### 3. `symbols` — `USING true` for `PUBLIC`

Probably correct: public ticker reference data, written by an RLS-bypassing upsert. Graded HIGH by the map's heuristic because the predicate contains no identity check, which is the rule working as designed rather than a finding.

**Decision:** confirm it is intentional. If yes, the only work is an annotation so this stops being re-derived every time someone reads the drift panel.

### 4. `refresh_symbols_daily` — broken cron · no decision needed

Confirmed: the job posts with `headers := '{"Content-Type":"application/json"}'` — no `apikey`, no `Authorization`. Every other job pulls `cron_apikey` from the vault. `refresh-symbols` declares `verify_jwt=true`, so every run 401s at the gateway.

It reports success anyway, because `net.http_post` is asynchronous — `cron.job_run_details` records the enqueue, not the response.

Three further facts:
- No migration in the repo schedules a job by that name. It was created out-of-band, which is why the cron-auth migration sweep never saw it. `jobid` 7 vs 18–21 for the migrated set.
- It is named `_daily` and runs `0 */6 * * *` — every six hours.
- Any environment rebuilt from migrations will not have this job at all.

**Do:** write a migration that reschedules it with the vault `apikey` header, matching the four working jobs. Fix the name/schedule disagreement — tell me which way you resolved it and why. Include a query I can run afterward to confirm the job now authenticates (`net._http_response` has roughly a 6h TTL, so it has to be run shortly after a firing).

### 5. Eight unrecorded `verify_jwt` settings

These functions have no `[functions.<name>]` block in `supabase/config.toml`, so the platform default applies and the repo does not record what it is:

`finnhub-quote`, `get-broker-keys`, `historical-bars`, `place-order`, `save-broker-keys`, `symbol-name`, `symbols-search`, `ticker-quotes`

Three of them are the highest-blast-radius endpoints in the system: `save-broker-keys` writes encrypted Alpaca credentials, `get-broker-keys` reads them, `place-order` executes trades. The inconsistency is already visible — `quote` is `verify_jwt=true` while `place-order`, on the same per-user credential path, is unset.

This is not necessarily a hole. It is an unknown, which is worse in a repo that claims to be auditable.

**Do:** tell me exactly what to look at in the dashboard and in what order. When I report the eight values back, write them into `config.toml` so the repo becomes the source of truth, and flag any that surprise you.

Related, in the same pass: `verify_jwt=false` on the three cron functions is asserted **only by a migration's prose comment**. There is no `config.toml` entry backing it anywhere. Record it properly.

**Also:** `get-broker-keys` has zero inbound edges — no client, no edge function, no cron calls it, and it reads the encrypted credential table. Confirm no caller exists that the grep cannot see, then recommend deleting it. A deployed uncalled endpoint over broker credentials is attack surface with no benefit.

### 6. `snapshot-week-end` modernization · start here, no input needed

This is the largest item and it needs nothing from me. It is also the **last live instance** of the partial-state pattern documented in `CLAUDE.md`.

Its guard at `index.ts:301` is existence-only: `alreadyProcessed = existingSnapshots?.some(s => s.week_end_price != null)`. If a run writes some participants and throws, the retry sees one end-priced row, treats the whole league as done, skips, and reports success. **A partial week-end write cannot be healed.**

That has a second consequence: the `schedule_snapshot_retry` fix that landed tonight restored retries for `snapshot-week-start`, but retries into `snapshot-week-end` remain *ineffective* — they fire and no-op. So this item blocks both partial-write prevention and retry effectiveness.

**Do:** bring it to the standard `snapshot-week-start` now has —

- per-participant coverage gate replacing the existence check, so a partial write is detected and healed rather than read as complete
- all-or-nothing writes: if any holding lacks a price, write nothing for that league this run and let the retry re-attempt
- decision logic extracted into a pure module with hermetic tests, following `plan.ts` / `grouping.ts` / `scoring-eligibility.ts`
- idempotent upsert on the unique constraint

Read `snapshot-week-start/index.ts` and `plan.ts` first — the pattern is already solved there, and the two functions should end up structurally symmetrical. Where they must differ, say why.

Note `snapshot-week-end` also carries the `entered_mid_week` write added in `cc26857`; do not regress it.

---

## What "done" looks like

One report at the end containing:

| Item | Branch | Status | What I need to run |
|---|---|---|---|

Plus, explicitly:
- anything you found that contradicts this document
- anything you chose not to do, and why
- whether `node scripts/gen-architecture.mjs --check` exits 0 on each branch
