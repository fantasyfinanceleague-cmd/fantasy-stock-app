# Pre-commit check for the architecture map — PROPOSAL

**Nothing here is installed.** This file describes what to add and what it would cost.
Adopting it is a deliberate decision, not a side effect of generating the map.

---

## Finding first: there is no broken hook. There is no hook.

The `--no-verify` habit is well-founded history — a hook was failing earlier in this
repo's life — but the hook itself is gone. Verified on this branch:

| Check | Result |
|---|---|
| `git config core.hooksPath` | unset |
| `.git/hooks/` (common dir, shared by all worktrees) | 12 `*.sample` files, nothing else |
| `.husky/` | absent |
| `pre-commit` anywhere in the repo | none |

So `--no-verify` currently suppresses nothing. "Fixing the broken hook" is not the task;
**installing a first hook** is. That is a smaller job than expected, but it does mean
there is no existing failure to diagnose — if a hook misbehaves after this, it is new.

---

## What to add

### 1. `.githooks/pre-commit`

```bash
#!/usr/bin/env bash
# Keep docs/architecture/architecture.json in step with the code it describes.
#
# Runs ONLY when a commit touches an input the map is derived from. A commit that
# touches nothing architectural pays nothing.
set -euo pipefail

staged=$(git diff --cached --name-only --diff-filter=ACMR)

if ! grep -qE '^(supabase/(functions|migrations)/|supabase/config\.toml$|apps/(mobile|web)/|packages/)' <<<"$staged"; then
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "pre-commit: node not found — skipping architecture check." >&2
  exit 0
fi

if ! node scripts/gen-architecture.mjs --check; then
  cat >&2 <<'EOF'

The architecture map is out of date with this commit.

  Fix:   node scripts/gen-architecture.mjs && git add docs/architecture/
  Skip:  git commit --no-verify   (the map will be stale until someone regenerates it)

EOF
  exit 1
fi
```

### 2. One-time, per clone

```bash
git config core.hooksPath .githooks
```

```bash
chmod +x .githooks/pre-commit
```

---

## What this costs you

**`core.hooksPath` is local config and does NOT propagate.** It is not committed, not
cloned, and not inherited. Every clone — including you on a second machine — has no hook
until someone runs that config command by hand. There is no way to make a git hook
self-installing from a clone alone; that is the whole reason tools like Husky exist.
Practical options, cheapest first:

1. **Document it in the README** and accept that a fresh clone is unprotected until
   someone reads it. Fine for a solo repo, weak for a team.
2. **Add a `prepare` script to the root `package.json`** — `"prepare": "git config
   core.hooksPath .githooks"` — which npm runs automatically after `npm install`. This is
   the standard trick and costs nothing extra, since the repo already has an install step.
   It does mean `npm install` silently mutates git config, which some people dislike.
3. **Husky.** Solves it properly, adds a dependency to a repo that currently has two.
   Not worth it for one hook.

I'd take option 2 if you want this to actually stick, option 1 if you'd rather git config
stay untouched by npm.

**Worktrees inherit it automatically.** Hooks resolve through the common git dir, so
setting `core.hooksPath` once in the main clone covers every worktree under
`.claude/worktrees/`. No per-worktree setup.

**Runtime.** The generator walks `apps/`, `supabase/`, and `packages/` and hashes the
extracted facts. On this repo `--check` completes in well under a second, so the hook is
not a meaningful tax on commit speed. It is gated on staged paths anyway.

**The failure mode is a blocked commit, not a wrong one.** `--check` never writes. The
worst case is that it reports stale and you either regenerate or pass `--no-verify` —
which is exactly the habit you already have, so the escape hatch is familiar.

---

## What it will NOT catch

Worth being explicit, because a check that looks total and isn't is worse than none:

- **A stale `db-snapshot.json`.** The hook compares `sourceHash`, and the snapshot's own
  hash is one of its inputs — so a snapshot you *changed* is caught, but a snapshot you
  *failed to refresh* is not. Nothing in git can know prod drifted. The viewer's age badge
  is the control for that, not the hook.
- **Prose going stale.** `annotations.json` is deliberately excluded from `sourceHash` so
  that writing prose never marks the map stale. The trade is that an annotation describing
  code that has since changed will not be flagged.
- **A flow whose steps are wrong but still resolve.** Anchors catch a moved or deleted
  line; they do not catch a step that is simply describing the wrong thing.

---

## Recommendation

Add the hook and take option 2 for distribution. The check is cheap, gated, and its
failure message tells you the exact command to fix it. But treat it as protection against
*forgetting to regenerate*, not as an architecture correctness guarantee — the three gaps
above are real and none of them are closable by a pre-commit hook.
