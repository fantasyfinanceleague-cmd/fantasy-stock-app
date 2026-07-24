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

**General:** after a dry-run or any state change, verify the ACTUAL state (grep / `git status` / a query) before building on it. Don't assume a command did what its output implied.
