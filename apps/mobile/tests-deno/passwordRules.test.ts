/**
 * Hermetic unit tests for constants/passwordRules.ts. Run from
 * apps/mobile/tests-deno (see that directory's deno.json):
 *
 *   cd apps/mobile/tests-deno && deno test .
 *
 * This is the single source of truth for the password policy — the
 * signup checklist (login.tsx) and the shared checkPassword() used by
 * both login.tsx and reset-password.tsx all read from PASSWORD_REQUIREMENTS
 * here, so a policy bug caught here is caught everywhere it's enforced.
 */
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_REQUIREMENTS,
  PASSWORD_RULE_SENTENCE,
  failingPasswordRequirements,
  checkPassword,
} from '../constants/passwordRules.ts';

Deno.test('checkPassword: a password meeting every requirement is valid with nothing failing', () => {
  const result = checkPassword('Abcdefg1!');
  assertEquals(result.valid, true);
  assertEquals(result.failing, []);
});

Deno.test('checkPassword: too short fails length even if every other class is present', () => {
  const result = checkPassword('Ab1!');
  assertEquals(result.valid, false);
  assertEquals(result.failing.map((r) => r.id), ['length']);
});

Deno.test('checkPassword: missing uppercase is reported', () => {
  const result = checkPassword('abcdefg1!');
  assertEquals(result.valid, false);
  assertEquals(result.failing.some((r) => r.id === 'uppercase'), true);
});

Deno.test('checkPassword: missing lowercase is reported', () => {
  const result = checkPassword('ABCDEFG1!');
  assertEquals(result.valid, false);
  assertEquals(result.failing.some((r) => r.id === 'lowercase'), true);
});

Deno.test('checkPassword: missing digit is reported', () => {
  const result = checkPassword('Abcdefgh!');
  assertEquals(result.valid, false);
  assertEquals(result.failing.some((r) => r.id === 'digit'), true);
});

Deno.test('checkPassword: missing symbol is reported', () => {
  const result = checkPassword('Abcdefgh1');
  assertEquals(result.valid, false);
  assertEquals(result.failing.some((r) => r.id === 'symbol'), true);
});

Deno.test('checkPassword: empty string fails every requirement', () => {
  const result = checkPassword('');
  assertEquals(result.valid, false);
  assertEquals(result.failing.length, PASSWORD_REQUIREMENTS.length);
});

Deno.test('checkPassword.failing matches failingPasswordRequirements exactly', () => {
  // checkPassword is a thin wrapper — this pins that relationship so the
  // two never quietly diverge.
  for (const pw of ['', 'short', 'Abcdefg1!', 'nouppercase1!', 'NOLOWERCASE1!']) {
    assertEquals(checkPassword(pw).failing, failingPasswordRequirements(pw));
  }
});

Deno.test('PASSWORD_RULE_SENTENCE names the real minimum length', () => {
  assertStringIncludes(PASSWORD_RULE_SENTENCE, String(PASSWORD_MIN_LENGTH));
});
