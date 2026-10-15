/**
 * The username SUGGESTION: a gamertag, never a name (Giorgio, 2026-10-14:
 * "{adjective or word}{animal}{digits}", e.g. HelpfulHornet151). It reads no
 * name and no email from any sign-in.
 *
 * MIRROR PENDING: W4 owns the app's generator (its word lists decide the
 * style). Until it lands this is a working stand-in so the web flow is real,
 * and the orchestrator will relay W4's path so this becomes a mirror with a
 * parity test (usernameSuggestion.parity.test.ts has the todo). It is
 * deliberately small; every candidate is checked against the same format rule
 * and then by check_usernames before it is offered.
 */
import { USERNAME_RE } from './usernameRules';

const ADJECTIVES = ['Helpful', 'Brave', 'Swift', 'Clever', 'Mighty', 'Lucky', 'Steady', 'Bold', 'Calm', 'Eager', 'Fierce', 'Nimble'];
const ANIMALS = ['Hornet', 'Falcon', 'Otter', 'Badger', 'Lynx', 'Heron', 'Bison', 'Marten', 'Osprey', 'Fox', 'Stoat', 'Raven'];

/** `random` is injectable (0 <= r < 1) so tests are deterministic. */
export function suggestUsername(random: () => number = Math.random): string {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(random() * xs.length) % xs.length];
  const digits = String(Math.floor(random() * 900) + 100); // 100..999
  const name = `${pick(ADJECTIVES)}${pick(ANIMALS)}${digits}`;
  return USERNAME_RE.test(name) ? name : `Player${digits}`;
}
