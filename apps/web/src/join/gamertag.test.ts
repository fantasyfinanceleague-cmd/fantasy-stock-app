import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ADJECTIVES, ANIMALS, gamertagCandidates, isGamertagSafe, makeGamertag, pickAvailableGamertag, seededRng, suggestGamertag, SUGGEST_TIMEOUT_MS,
  type AvailabilityRow,
} from './gamertag';
import { USERNAME_RE } from './usernameRules';

describe('the word lists', () => {
  it('are real, distinct, single-word and capitalised', () => {
    for (const list of [ADJECTIVES, ANIMALS]) {
      expect(list.length).toBeGreaterThan(30);
      expect(new Set(list.map((w) => w.toLowerCase())).size).toBe(list.length);
      for (const w of list) expect(w).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  it('every adjective + animal + three digits is a valid username (<= 20 characters)', () => {
    for (const a of ADJECTIVES) for (const n of ANIMALS) {
      const tag = `${a}${n}999`;
      expect(tag.length).toBeLessThanOrEqual(20);
      expect(USERNAME_RE.test(tag)).toBe(true);
    }
  });
});

describe('makeGamertag', () => {
  it('is {adjective}{Animal}{two or three digits}', () => {
    const rng = seededRng(7);
    for (let i = 0; i < 500; i++) {
      const tag = makeGamertag(rng);
      expect(tag).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{2,3}$/);
      expect(isGamertagSafe(tag)).toBe(true);
    }
  });

  it('is deterministic for a seeded source, and different seeds differ', () => {
    expect(makeGamertag(seededRng(151))).toBe(makeGamertag(seededRng(151)));
    expect(new Set([1, 2, 3, 4, 5].map((s) => makeGamertag(seededRng(s)))).size).toBeGreaterThan(1);
  });

  it('takes NO input but a random source (never a name, an email or a session)', () => {
    expect(makeGamertag.length).toBe(1);
    const code = readFileSync(resolve(process.cwd(), 'src/join/gamertag.ts'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/email|session|user_metadata|first_?name|full_?name|display_?name|identity|getUser/i);
  });
});

describe('gamertagCandidates', () => {
  it('returns distinct tags, at most n, never looping forever on a stuck source', () => {
    const tags = gamertagCandidates(seededRng(3), 10);
    expect(tags).toHaveLength(10);
    expect(new Set(tags.map((t) => t.toLowerCase())).size).toBe(10);
    expect(gamertagCandidates(() => 0, 5)).toHaveLength(1); // a source that never varies yields ONE, and returns
  });
});

describe('pickAvailableGamertag', () => {
  const rows = (candidates: string[], free: string[]): AvailabilityRow[] => candidates.map((username) => ({ username, status: free.includes(username) ? 'available' : 'taken' }));

  it('returns the first candidate the server says is available', async () => {
    const calls: string[][] = [];
    const tag = await pickAvailableGamertag(seededRng(1), async (c) => { calls.push(c); return rows(c, [c[2]]); });
    expect(tag).toBe(calls[0][2]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(8);
  });

  it('on a clash tries another batch, up to 3, and never offers a name nobody checked', async () => {
    let n = 0;
    const seen: string[][] = [];
    const tag = await pickAvailableGamertag(seededRng(1), async (c) => { seen.push(c); n += 1; return rows(c, n === 3 ? [c[0]] : []); });
    expect(tag).toBe(seen[2][0]);
    expect(await pickAvailableGamertag(seededRng(1), async (c) => rows(c, []))).toBeNull();
  });

  it('is null when the check itself FAILED (offline): the empty field, not a guess', async () => {
    expect(await pickAvailableGamertag(seededRng(1), async () => null)).toBeNull();
  });

  it('asks for at most 10 at a time (check_usernames\' limit)', async () => {
    let size = 0;
    await pickAvailableGamertag(seededRng(1), async (c) => { size = c.length; return rows(c, [c[0]]); }, { batch: 50 });
    expect(size).toBe(10);
  });
});

describe('suggestGamertag (web-only helper)', () => {
  it('resolves to the checked tag', async () => {
    const tag = await suggestGamertag(async (c) => c.map((username, i) => ({ username, status: i === 1 ? 'available' : 'taken' })), seededRng(9));
    expect(tag).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{2,3}$/);
  });

  it('is null when the check is slower than the timeout, and then ignores the late answer', async () => {
    vi.useFakeTimers();
    try {
      let release: (rows: AvailabilityRow[]) => void = () => {};
      const slow = new Promise<AvailabilityRow[]>((r) => { release = r; });
      const result = suggestGamertag(() => slow, seededRng(9), 50);
      await vi.advanceTimersByTimeAsync(60);
      expect(await result).toBeNull();
      release([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is null (never throws) when the check rejects', async () => {
    expect(await suggestGamertag(async () => { throw new Error('boom'); }, seededRng(9))).toBeNull();
  });

  it('the default timeout is the app\'s 6 seconds', () => {
    expect(SUGGEST_TIMEOUT_MS).toBe(6000);
  });
});
