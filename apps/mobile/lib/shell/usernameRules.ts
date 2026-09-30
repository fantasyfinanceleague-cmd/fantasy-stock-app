// Phase 3b-1 — the username format rule, client side.
//
// The server is the truth (spec: "set_username / check_usernames enforce
// ^[A-Za-z0-9_]{3,20}$ with case-insensitive uniqueness"). This file mirrors
// the FORMAT half so the screen can check it live as the user types; a
// hermetic test (tests-deno/shell-username.test.ts) reads the migration SQL
// and fails if the two regexes ever differ. Uniqueness is never judged here.
//
// Pure (no React Native imports) so tests-deno can exercise it hermetically.

/** Byte-for-byte the pattern in 20261007000000_username_write_path.sql. */
export const USERNAME_PATTERN = '^[A-Za-z0-9_]{3,20}$';
export const USERNAME_RE = new RegExp(USERNAME_PATTERN);

export const RULE_LENGTH = '3–20 characters';
export const RULE_CHARSET = 'Letters, numbers and underscores';

export interface UsernameRuleCheck {
  label: string;
  ok: boolean;
}

/** The two inline rules, in display order, each met or not (spec: shown inline). */
export function usernameRuleChecks(value: string): UsernameRuleCheck[] {
  return [
    { label: RULE_LENGTH, ok: value.length >= 3 && value.length <= 20 },
    { label: RULE_CHARSET, ok: value.length > 0 && /^[A-Za-z0-9_]+$/.test(value) },
  ];
}

/** Spec: "format → the rule that failed". null when the format is valid. */
export function firstFailingRule(value: string): string | null {
  const failing = usernameRuleChecks(value).find((r) => !r.ok);
  return failing ? failing.label : null;
}
