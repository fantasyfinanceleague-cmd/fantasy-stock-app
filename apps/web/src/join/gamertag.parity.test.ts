// @vitest-environment node
//
// The web gamertag generator is a MIRROR of the app's (apps/mobile/lib/shell/gamertag.ts). This loads the
// app's own module (it and the modules it imports are pure) and fails on any drift: the word lists, the
// seeded random source, a long seeded sequence, the candidates, pickAvailableGamertag's behaviour, and the
// content safety of every tag the web lists can build, judged by the APP's own check.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type * as AppGamertag from '../../../mobile/lib/shell/gamertag';
import * as web from './gamertag';
import { loadMobile, mobilePath } from './testing/loadMobile';

const app = loadMobile<typeof AppGamertag>('lib/shell/gamertag.ts');
const SEEDS = [0, 1, 2, 7, 42, 151, 1337, 65535, 2 ** 31, 0xdeadbeef, 4294967295];

describe('the word lists are the app\'s, exactly (same words, same order)', () => {
  it('adjectives', () => expect([...web.ADJECTIVES]).toEqual([...app.ADJECTIVES]));
  it('animals', () => expect([...web.ANIMALS]).toEqual([...app.ANIMALS]));
});

describe('the random source and the generator behave identically', () => {
  it.each(SEEDS)('seededRng(%d): the same first 100 values', (seed) => {
    const a = web.seededRng(seed);
    const b = app.seededRng(seed);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it.each(SEEDS)('makeGamertag over seededRng(%d): the same 300 tags in a row', (seed) => {
    const a = web.seededRng(seed);
    const b = app.seededRng(seed);
    for (let i = 0; i < 300; i++) expect(web.makeGamertag(a)).toBe(app.makeGamertag(b));
  });

  it.each([1, 3, 8, 10, 25])('gamertagCandidates(n=%d) over several seeds', (n) => {
    for (const seed of SEEDS) expect(web.gamertagCandidates(web.seededRng(seed), n)).toEqual(app.gamertagCandidates(app.seededRng(seed), n));
  });

  it('a stuck source (always the same value) gives the same, bounded answer', () => {
    for (const v of [0, 0.5, 0.999999]) expect(web.gamertagCandidates(() => v, 6)).toEqual(app.gamertagCandidates(() => v, 6));
  });
});

describe('pickAvailableGamertag behaves identically (same candidates asked, same answer)', () => {
  type Row = { username: string; status: string };
  const scenarios: [string, (call: number, c: string[]) => Row[] | null][] = [
    ['the 3rd candidate is free at once', (_n, c) => c.map((username, i) => ({ username, status: i === 2 ? 'available' : 'taken' }))],
    ['free only in the 3rd batch', (n, c) => c.map((username, i) => ({ username, status: n === 3 && i === 5 ? 'available' : 'taken' }))],
    ['never free', (_n, c) => c.map((username) => ({ username, status: 'taken' }))],
    ['the check fails at once', () => null],
    ['the check fails on the 2nd batch', (n, c) => (n === 2 ? null : c.map((username) => ({ username, status: 'taken' })))],
    ['rows for names that were not asked', () => [{ username: 'SomebodyElse1', status: 'available' }]],
    ['an unknown status', (_n, c) => c.map((username) => ({ username, status: 'weird' }))],
  ];

  it.each(scenarios)('%s', async (_label, answer) => {
    for (const seed of [1, 42, 151]) {
      const asked = { web: [] as string[][], app: [] as string[][] };
      let nw = 0;
      let na = 0;
      const webTag = await web.pickAvailableGamertag(web.seededRng(seed), async (c) => { asked.web.push(c); return answer(++nw, c); });
      const appTag = await app.pickAvailableGamertag(app.seededRng(seed), async (c) => { asked.app.push(c); return answer(++na, c); });
      expect(webTag).toBe(appTag);
      expect(asked.web).toEqual(asked.app);
    }
  });

  it('the options (batch, attempts) mean the same thing', async () => {
    const check = (log: string[][]) => async (c: string[]) => { log.push(c); return c.map((username) => ({ username, status: 'taken' })); };
    const w: string[][] = [];
    const a: string[][] = [];
    await web.pickAvailableGamertag(web.seededRng(5), check(w), { batch: 4, attempts: 2 });
    await app.pickAvailableGamertag(app.seededRng(5), check(a), { batch: 4, attempts: 2 });
    expect(w).toEqual(a);
    expect(w).toHaveLength(2);
    expect(w[0]).toHaveLength(4);
  });
});

describe('content safety: the web builds only tags the APP\'s own check accepts', () => {
  it('EVERY adjective x animal pair (with digit suffixes) passes the app\'s isGamertagSafe (format + its content blocklist)', () => {
    // the blocklist is letters only and the digits come last, so the pairs decide; a few suffixes prove it
    for (const adjective of web.ADJECTIVES) for (const animal of web.ANIMALS) {
      for (const digits of ['10', '151', '999']) {
        const tag = `${adjective}${animal}${digits}`;
        expect({ tag, safe: app.isGamertagSafe(tag) }).toEqual({ tag, safe: true });
        expect(web.isGamertagSafe(tag)).toBe(true);
      }
    }
  });

  it('web.isGamertagSafe (format only) agrees with the app\'s on real tags and on obvious junk', () => {
    for (const tag of ['HelpfulHornet151', 'ab', 'has space', 'x'.repeat(21), 'ok_1', 'bad-name', '']) {
      expect(web.isGamertagSafe(tag)).toBe(/^[A-Za-z0-9_]{3,20}$/.test(tag));
    }
  });

  it('a long seeded run on the web produces only tags the app accepts', () => {
    const rng = web.seededRng(2026);
    for (let i = 0; i < 5000; i++) expect(app.isGamertagSafe(web.makeGamertag(rng))).toBe(true);
  });
});

describe('the app\'s picker timeout is mirrored', () => {
  it('SUGGEST_TIMEOUT_MS equals the constant in components/shell/UsernamePicker.tsx (a React Native file: read as text)', () => {
    const src = readFileSync(mobilePath('components/shell/UsernamePicker.tsx'), 'utf-8');
    const appMs = Number(/export const SUGGEST_TIMEOUT_MS = (\d+);/.exec(src)?.[1]);
    expect(Number.isFinite(appMs)).toBe(true);
    expect(web.SUGGEST_TIMEOUT_MS).toBe(appMs);
  });
});
