<!-- Append this section to your existing CLAUDE.md (or create one at repo root). -->

## Subagent roster & delegation rules

This repo defines project-scoped subagents in `.claude/agents/`. They exist to keep the main session's context clean and to enforce the prod/secret handoff model structurally.

**The rule that governs all of them:** no subagent runs prod-mutating commands. `supabase db push`, edge-function deploys, real-key curls, vault rotations, and merges to `main` are Giorgio's alone. Subagents flag and hand off; they do not act on the money/prod path. This mirrors the approval tiers: read-only/branch work runs freely; anything prod-mutating hard-stops for a human.

| Agent | Model | Tools | Purpose |
|---|---|---|---|
| `explorer` | haiku | Read, Grep, Glob | Read-only recon across the monorepo. Cheap, fast, keeps context clean. |
| `security-reviewer` | sonnet | Read, Grep, Glob | Flags secret exposure, auth gaps, injection, blast-radius violations. Read-only by design. |
| `supabase-reviewer` | sonnet | Read, Grep, Glob | Reviews migrations, RLS, edge functions, cron/vault SQL. Ends with explicit HUMAN ACTION handoffs. |
| `test-writer` | sonnet | Read, Write, Edit, Bash, Grep, Glob | Writes and runs tests on a branch. Stays in test files; reports source bugs rather than patching. |

**Secret handling:** if any subagent surfaces a real key VALUE (not a variable name), it must report the location and type and mark it for rotation — never reproduce the value. Even test exposure requires rotation.

**Reminder:** subagents load at session start. If you edit a file in `.claude/agents/` on disk, restart the session (or use `/agents` to edit, which takes effect immediately).

## Model selection (orchestrator)

The session model is the orchestrator; each subagent runs on the `model:` in its own frontmatter (Haiku for `explorer`, Sonnet for the reviewers), regardless of the session model. Switch the session model with `/model <alias>`; `/status` shows the active one.

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
