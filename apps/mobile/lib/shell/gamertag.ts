/**
 * The username generator (onboarding W4; Giorgio, 2026-10-14, PRODUCT_RULES "Onboarding"): an
 * Xbox-style gamertag, {adjective or word}{Animal}{digits} ("HelpfulHornet151"). Playful and
 * unique, and NEVER derived from a person: not the first name, not the email, not anything Apple
 * or Google shares ("let's not expose their first names"). So nothing here takes any input but a
 * random source, and a test pins that the module never mentions a name, an email or a session.
 *
 * Pure (no React Native, no network), so tests-deno runs it hermetically. The random source is
 * injected: the app passes Math.random, the tests a seeded generator.
 *
 * Every tag is format-valid (^[A-Za-z0-9_]{3,20}$) and passes the app's content check
 * (lib/contentModeration.ts blocks words as SUBSTRINGS, so the lists avoid "ass", "tit", "anal"
 * and the rest, and the test runs every adjective × animal through it). Availability is the
 * server's call (check_usernames): pickAvailableGamertag asks and retries on a clash.
 */
import { validateUsername } from '../contentModeration';
import { USERNAME_RE } from './usernameRules';

/** A random source: () => a float in [0, 1). */
export type Rng = () => number;

/** mulberry32: a small seeded generator, so tests (and a capture) can be deterministic. */
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

// Curated: friendly words and real animals; each ≤ 8 letters so adjective + animal + 3 digits
// is ≤ 19 characters (the server's cap is 20). No word that contains a blocked substring.
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

/** Whether a tag is something the app would accept as a username (format + content check). */
export function isGamertagSafe(tag: string): boolean {
  return USERNAME_RE.test(tag) && validateUsername(tag).isValid;
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
