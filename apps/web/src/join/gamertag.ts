/**
 * The username suggestion: an Xbox-style gamertag, {adjective}{Animal}{digits}
 * ("HelpfulHornet151"). Giorgio, 2026-10-14: playful and unique, and NEVER derived
 * from a person (no first name, no email, nothing Apple or Google shares). So
 * nothing here takes any input but a random source.
 *
 * A MIRROR of the app's generator, apps/mobile/lib/shell/gamertag.ts (onboarding
 * W4): the SAME word lists, the same mulberry32 `seededRng`, the same algorithm.
 * gamertag.parity.test.ts loads the app's own module and fails on any drift: the
 * lists, a seeded sequence, the candidates, and pickAvailableGamertag's behaviour.
 * Change the app's first, never this one alone.
 *
 * One deliberate difference: `isGamertagSafe` checks the FORMAT only. The app also
 * runs lib/contentModeration (a blocklist that matches words as SUBSTRINGS), which
 * the web has no copy of. It does not need one: the blocklist is letters only, the
 * digits are appended last, so safety depends only on the adjective x animal pairs,
 * and the parity test runs EVERY pair through the app's own check. Availability is
 * the server's call (check_usernames) in both.
 */
import { USERNAME_RE } from './usernameRules';

/** A random source: () => a float in [0, 1). */
export type Rng = () => number;

/** mulberry32: a small seeded generator, so tests are deterministic. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ADJECTIVES = [
  'Brave', 'Bold', 'Bright', 'Bouncy', 'Calm', 'Cheery', 'Clever', 'Cosmic', 'Crisp', 'Daring',
  'Dapper', 'Eager', 'Epic', 'Fearless', 'Fierce', 'Frosty', 'Fuzzy', 'Gentle', 'Giddy', 'Golden',
  'Happy', 'Helpful', 'Humble', 'Jolly', 'Keen', 'Lively', 'Lucky', 'Merry', 'Mighty', 'Nimble',
  'Noble', 'Peppy', 'Plucky', 'Proud', 'Quick', 'Quiet', 'Rapid', 'Royal', 'Savvy', 'Sharp',
  'Silver', 'Sly', 'Snappy', 'Speedy', 'Spry', 'Steady', 'Stellar', 'Sunny', 'Swift', 'Turbo',
  'Vivid', 'Wild', 'Witty', 'Zesty',
] as const;

export const ANIMALS = [
  'Badger', 'Beaver', 'Bison', 'Condor', 'Cougar', 'Coyote', 'Crane', 'Dolphin', 'Eagle', 'Falcon',
  'Ferret', 'Fox', 'Gecko', 'Heron', 'Hornet', 'Jaguar', 'Koala', 'Lemur', 'Lynx', 'Mantis',
  'Marmot', 'Mongoose', 'Moose', 'Narwhal', 'Osprey', 'Otter', 'Panda', 'Parrot', 'Pelican',
  'Penguin', 'Puffin', 'Quokka', 'Raccoon', 'Raven', 'Salmon', 'Sparrow', 'Tiger', 'Walrus',
  'Weasel', 'Wombat', 'Yak', 'Zebra',
] as const;

/** A whole number in [lo, hi]. */
function between(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** One tag: {adjective}{Animal}{two or three digits}, e.g. "HelpfulHornet151". */
export function makeGamertag(rng: Rng): string {
  const adjective = ADJECTIVES[between(rng, 0, ADJECTIVES.length - 1)];
  const animal = ANIMALS[between(rng, 0, ANIMALS.length - 1)];
  return `${adjective}${animal}${between(rng, 10, 999)}`;
}

/** Whether a tag is a valid username FORMAT (the content check is the parity test's job, see the header). */
export function isGamertagSafe(tag: string): boolean {
  return USERNAME_RE.test(tag);
}

/** Up to `n` distinct (case-insensitive), safe tags. Bounded: a stuck source cannot loop forever. */
export function gamertagCandidates(rng: Rng, n: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n * 6 && out.length < n; i++) {
    const tag = makeGamertag(rng);
    const key = tag.toLowerCase();
    if (seen.has(key) || !isGamertagSafe(tag)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export interface AvailabilityRow {
  username: string;
  status: string;
}

/** check_usernames, injected: the rows, or null when the check itself failed. */
export type CheckAvailability = (candidates: string[]) => Promise<AvailabilityRow[] | null>;

/**
 * A tag the server says is available, or null. Asks for a batch (check_usernames takes up to 10),
 * and on a clash tries another batch, up to `attempts`. null also when the check FAILED (offline):
 * the caller then shows the empty field to type in, never a name nobody checked.
 */
export async function pickAvailableGamertag(rng: Rng, check: CheckAvailability, opts: { batch?: number; attempts?: number } = {}): Promise<string | null> {
  const batch = Math.min(opts.batch ?? 8, 10);
  const attempts = opts.attempts ?? 3;
  for (let i = 0; i < attempts; i++) {
    const candidates = gamertagCandidates(rng, batch);
    const rows = await check(candidates);
    if (!rows) return null;
    const free = new Set(rows.filter((r) => r.status === 'available').map((r) => r.username));
    const hit = candidates.find((c) => free.has(c));
    if (hit) return hit;
  }
  return null;
}

/** The app's UsernamePicker SUGGEST_TIMEOUT_MS (a read of the constant is pinned by the parity test). */
export const SUGGEST_TIMEOUT_MS = 6000;

/**
 * WEB-ONLY helper (not in the app's module): a checked suggestion within the timeout, or null. A slow or
 * failed check is the plain form, an empty field, never a name nobody checked (the app's rule, in its picker).
 */
export function suggestGamertag(check: CheckAvailability, rng: Rng = Math.random, timeoutMs: number = SUGGEST_TIMEOUT_MS): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    pickAvailableGamertag(rng, check).then(
      (tag) => { clearTimeout(timer); resolve(tag); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}
