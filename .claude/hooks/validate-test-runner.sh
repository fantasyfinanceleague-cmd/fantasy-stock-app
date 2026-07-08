#!/usr/bin/env bash
# PreToolUse guard for the `test-writer` subagent's Bash tool.
#
# Purpose: turn test-writer's "stay in test runs" from prose into a structural
# fence. Default-DENY: only this repo's real test-runner invocations pass;
# every other shell command is blocked (exit 2). This is what makes the
# CLAUDE.md "no subagent runs prod-mutating commands" claim TRUE for the one
# agent that still has a shell.
#
# Wired via .claude/agents/test-writer.md frontmatter (hooks.PreToolUse,
# matcher: Bash). Receives the tool call as JSON on stdin.
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"

if [ -z "$cmd" ]; then
  echo "test-writer: empty/unparseable Bash command — blocked." >&2
  exit 2
fi

# 1) Reject multi-line commands (an embedded newline can smuggle a second command).
if [ "$(printf '%s' "$cmd" | wc -l | tr -d ' ')" != "0" ]; then
  echo "test-writer: multi-line commands are not allowed. Blocked." >&2
  exit 2
fi

# 2) Reject shell chaining / substitution / redirection, so nothing can be
#    appended after an allow-listed prefix (e.g. `npm test && supabase db push`).
case "$cmd" in
  *"&&"*|*"||"*|*";"*|*"|"*|*'`'*|*'$('*|*">"*|*"<"*)
    echo "test-writer: shell operators (&& || ; | \` \$( > <) are not allowed. Blocked: $cmd" >&2
    exit 2
    ;;
esac

# 3) Allowlist — the ONLY test-runner commands this repo actually uses today.
#    (`npm run test:simulation` -> node scripts/simulation-test-runner.mjs.)
#    `npx jest ...` is pre-allowed for when a jest/jest-expo suite is added;
#    remove it if you want the fence tighter until then.
if printf '%s' "$cmd" | grep -qE '^[[:space:]]*(npm test|npm run test:simulation|npx jest([[:space:]].*)?)[[:space:]]*$'; then
  exit 0
fi

echo "test-writer: only 'npm test', 'npm run test:simulation', or 'npx jest ...' are permitted. Blocked: $cmd" >&2
exit 2
