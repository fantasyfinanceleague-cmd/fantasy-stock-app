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
import {
  canSubmit,
  initialUsernameState,
  MSG_CHECK_FAILED,
  MSG_NOT_ALLOWED,
  MSG_TAKEN,
  pickAvailable,
  sanitizeUsernameBase,
  usernameReducer,
  usernameSuggestions,
  usernameView,
  type UsernameEvent,
  type UsernameState,
} from '../lib/shell/usernameMachine.ts';

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

// ── The Pick-a-username state machine ─────────────────────────────────────


function run(events: UsernameEvent[], from: UsernameState = initialUsernameState): UsernameState {
  return events.reduce(usernameReducer, from);
}
const input = (value: string, current: string | null = null, contentOk = true): UsernameEvent => ({ type: 'input', value, contentOk, current });

Deno.test('machine: a valid input goes to checking; nothing is asked for invalid input', () => {
  assertEquals(run([input('roberto')]).kind, 'checking');
  const short = run([input('ro')]);
  assertEquals(short.kind, 'local-invalid');
  assertEquals(usernameView(short).error, RULE_LENGTH);
  assertEquals(usernameView(run([input('rob-b')])).error, RULE_CHARSET);
  assertEquals(usernameView(run([input('roberto', null, false)])).error, MSG_NOT_ALLOWED);
  assertEquals(run([input('   ')]).kind, 'empty');
});

Deno.test('machine: server outcomes map to the spec copy, verbatim', () => {
  const checking = run([input('roberto')]);
  const available = usernameReducer(checking, { type: 'check-result', seq: checking.seq, status: 'available' });
  assertEquals(usernameView(available), { ...usernameView(available), error: null, trailing: 'available', canContinue: true });

  const taken = usernameReducer(checking, { type: 'check-result', seq: checking.seq, status: 'taken', suggestions: ['roberto_26', 'roberto26', 'rbianchi', 'extra'] });
  const tv = usernameView(taken);
  assertEquals(tv.error, 'This username is already taken.');
  assertEquals(tv.error, MSG_TAKEN);
  assertEquals(tv.suggestions, ['roberto_26', 'roberto26', 'rbianchi']); // 3, not 4
  assertEquals(tv.canContinue, false);

  const invalid = usernameReducer(checking, { type: 'check-result', seq: checking.seq, status: 'invalid' });
  assertEquals(usernameView(invalid).error, MSG_NOT_ALLOWED); // format passed locally, so the server's reason is content
});

Deno.test('machine: a stale check result for an OLD input never overwrites the current one', () => {
  const first = run([input('roberto')]);
  const second = usernameReducer(first, input('roberto_b'));
  const staleTaken = usernameReducer(second, { type: 'check-result', seq: first.seq, status: 'taken', suggestions: [] });
  assertEquals(staleTaken, second);
  const fresh = usernameReducer(second, { type: 'check-result', seq: second.seq, status: 'available' });
  assertEquals(fresh.kind, 'available');
});

Deno.test('machine: a failed check is advisory — "Couldn\'t check right now" and Continue stays enabled', () => {
  const checking = run([input('roberto')]);
  const failed = usernameReducer(checking, { type: 'check-failed', seq: checking.seq });
  const v = usernameView(failed);
  assertEquals(v.note, MSG_CHECK_FAILED);
  assertEquals(v.error, null);
  assertEquals(v.canContinue, true);
});

Deno.test('machine: submit only from a submittable state; the server has the final word', () => {
  assertEquals(canSubmit(run([input('roberto')])), false); // still checking
  const checking = run([input('roberto')]);
  const available = usernameReducer(checking, { type: 'check-result', seq: checking.seq, status: 'available' });
  const submitting = usernameReducer(available, { type: 'submit' });
  assertEquals(submitting.kind, 'submitting');
  assertEquals(usernameView(submitting).busy, true);
  // Someone took it between the check and the save (the race set_username exists for).
  const raced = usernameReducer(submitting, { type: 'submit-result', seq: submitting.seq, result: 'taken', suggestions: ['a_b_c'] });
  assertEquals(usernameView(raced).error, MSG_TAKEN);
  const ok = usernameReducer(submitting, { type: 'submit-result', seq: submitting.seq, result: 'ok' });
  assertEquals(ok.kind, 'saved');
});

Deno.test('machine: edit mode — the same name is unchanged, a case-only change is a real change', () => {
  assertEquals(run([input('roberto_b', 'roberto_b')]).kind, 'unchanged');
  assertEquals(canSubmit(run([input('roberto_b', 'roberto_b')])), false);
  assertEquals(run([input('Roberto_B', 'roberto_b')]).kind, 'checking');
});

// ── Case-insensitive "taken": the client defers to the server ─────────────

/** A stand-in for check_usernames with the server's documented semantics:
 * case-insensitive, other users only. (The DB-level proof of this is
 * supabase/tests/username_write_path.pglite.test.ts.) */
function fakeCheckUsernames(existing: string[], callerCurrent: string | null) {
  return (candidates: string[]) =>
    candidates.map((c) => ({
      username: c,
      status: !USERNAME_RE.test(c)
        ? 'invalid'
        : existing.some((e) => e.toLowerCase() === c.toLowerCase() && e.toLowerCase() !== (callerCurrent ?? '').toLowerCase())
          ? 'taken'
          : 'available',
    }));
}

Deno.test('case-insensitive: with "roberto" taken, "Roberto" and "ROBERTO" are taken too', () => {
  const check = fakeCheckUsernames(['roberto'], null);
  for (const attempt of ['roberto', 'Roberto', 'ROBERTO', 'rObErTo']) {
    const checking = run([input(attempt)]);
    const [row] = check([attempt]);
    const after = usernameReducer(checking, { type: 'check-result', seq: checking.seq, status: row.status as 'taken' });
    assertEquals(usernameView(after).error, MSG_TAKEN, attempt);
  }
});

// ── Suggestions ───────────────────────────────────────────────────────────

Deno.test('suggestions: ≤ 9 (check_usernames caps at 10), unique case-insensitively, all format-valid, never the taken name', () => {
  for (const [typed, email] of [
    ['roberto', 'roberto.bianchi'],
    ['Roberto', null],
    ['a_very_long_username_x', 'someone'],
    ['rob', 'r'],
  ] as [string, string | null][]) {
    const s = usernameSuggestions(typed, email, 26);
    assertEquals(s.length > 0 && s.length <= 9, true, `${typed}: ${s.length}`);
    assertEquals(new Set(s.map((x) => x.toLowerCase())).size, s.length, typed);
    for (const c of s) {
      assertEquals(USERNAME_RE.test(c), true, c);
      assertEquals(c.toLowerCase() === typed.toLowerCase(), false, c);
    }
  }
});

Deno.test('suggestions: deterministic for a seed, and they include the email-derived name', () => {
  assertEquals(usernameSuggestions('roberto', 'roberto.bianchi', 26), usernameSuggestions('roberto', 'roberto.bianchi', 26));
  const s = usernameSuggestions('roberto', 'roberto.bianchi', 26);
  assertEquals(s.includes('roberto_26'), true);
  assertEquals(s.includes('roberto_bianchi'), true);
});

Deno.test('suggestions: sanitising keeps only the username alphabet', () => {
  assertEquals(sanitizeUsernameBase('Rób Bianchi-2.0'), 'Rob_Bianchi_2_0');
  assertEquals(sanitizeUsernameBase('__x__'), 'x');
  assertEquals(sanitizeUsernameBase('✨'), '');
});

Deno.test('suggestions: the 3 shown are the first available, in offer order', () => {
  const offered = usernameSuggestions('roberto', 'roberto.bianchi', 26);
  const rows = fakeCheckUsernames(['roberto', 'roberto_26', offered[2]], null)(offered);
  const shown = pickAvailable(offered, rows);
  assertEquals(shown.length, 3);
  assertEquals(shown.includes('roberto_26'), false);
  assertEquals(shown, offered.filter((c) => !['roberto_26', offered[2]].includes(c)).slice(0, 3));
});
