/**
 * Hermetic tests for the username flow's pure logic (Phase 3b-1).
 *
 *   cd apps/mobile/tests-deno && deno test .
 *
 * The regex-parity test imports the migration as text (deno.json enables
 * "raw-imports"), so it needs no --allow-read.
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  firstFailingRule,
  RULE_CHARSET,
  RULE_LENGTH,
  USERNAME_PATTERN,
  USERNAME_RE,
  usernameRuleChecks,
} from '../lib/shell/usernameRules.ts';

import migrationSql from '../../../supabase/migrations/20261007000000_username_write_path.sql' with { type: 'text' };

Deno.test('username format: the client regex is byte-identical to every regex in the server migration', () => {
  const serverPatterns = [...migrationSql.matchAll(/'(\^\[A-Za-z0-9_\]\{\d+,\d+\}\$)'/g)].map((m) => m[1]);
  // CHECK constraint, set_username, check_usernames — all three must agree with the client.
  assertEquals(serverPatterns.length >= 3, true, `expected >= 3 server patterns, found ${serverPatterns.length}`);
  for (const p of serverPatterns) assertEquals(p, USERNAME_PATTERN);
});

Deno.test('username format: accepts exactly what the server accepts', () => {
  for (const ok of ['rob', 'roberto_b', 'Roberto', 'ABC_123', 'a'.repeat(20), '___']) assertEquals(USERNAME_RE.test(ok), true, ok);
  for (const bad of ['', 'ro', 'a'.repeat(21), 'rob b', 'rob-b', 'robè', 'rob.b', 'rob\n']) assertEquals(USERNAME_RE.test(bad), false, JSON.stringify(bad));
});

Deno.test('username rules: the inline checklist reports each rule, verbatim', () => {
  assertEquals(usernameRuleChecks(''), [
    { label: '3–20 characters', ok: false },
    { label: 'Letters, numbers and underscores', ok: false },
  ]);
  assertEquals(usernameRuleChecks('roberto_b'), [
    { label: RULE_LENGTH, ok: true },
    { label: RULE_CHARSET, ok: true },
  ]);
  assertEquals(usernameRuleChecks('rob b'), [
    { label: RULE_LENGTH, ok: true },
    { label: RULE_CHARSET, ok: false },
  ]);
});

Deno.test('username rules: "format → the rule that failed", length first', () => {
  assertEquals(firstFailingRule('ro'), RULE_LENGTH);
  assertEquals(firstFailingRule('rob-b'), RULE_CHARSET);
  assertEquals(firstFailingRule('r-'), RULE_LENGTH);
  assertEquals(firstFailingRule('roberto_b'), null);
});
