import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanDisplay, MAX_DISPLAY_LENGTH, MAX_INVITER_LENGTH } from './displayText';
import { fetchInvitePreview, parseInvitePreview } from './invitePreview';
import { interpretJoin, parsePreviewLeague } from './previewData';

describe('cleanDisplay: text from outside, dropped into our own headline templates', () => {
  it.each([
    ['Stock Scudetto', 'Stock Scudetto'],
    ['  Stock   Scudetto \n', 'Stock Scudetto'],
    ['Wall\tStreet', 'Wall Street'],
    ['Bold\u202Eevil', 'Bold evil'], // right-to-left override
    ['a\u2066b\u2069c', 'a b c'], // isolates
    ['zero\u200Bwidth', 'zero width'],
    ['\uFEFFbom', 'bom'],
    ['ctrl\u0007bell', 'ctrl bell'],
    ['Émile 🏈 FC', 'Émile 🏈 FC'],
    // the second review's list: invisible or bidi, and not caught by the first cut
    ['a\u061Cb', 'a b'], // Arabic letter mark
    ['soft\u00ADhyphen', 'soft hyphen'],
    ['grapheme\u034Fjoiner', 'grapheme joiner'],
    ['mongolian\u180Evowel', 'mongolian vowel'],
    ['dep\u206Aformat', 'dep format'],
    ['fill\u115F\u1160\u3164\uFFA0ers', 'fill ers'], // Hangul fillers
    ['braille\u2800blank', 'braille blank'],
    ['var\uFE0Fsel', 'var sel'], // variation selector
    ['tag\u{E0041}char', 'tag char'], // tag character
    ['sel\u{E0100}ect', 'sel ect'], // variation selector supplement
    ['obj\uFFFCrepl', 'obj repl'],
    ['line\u2028sep\u2029para', 'line sep para'],
    ['non\u00A0breaking', 'non breaking'],
    // the third review's list
    ['khmer\u17B4vowel', 'khmer vowel'],
    ['mongolian\u180Bfvs\u180Fx', 'mongolian fvs x'],
    ['reserved\uFFF0special', 'reserved special'],
    ['reserved\u{E0FFF}ignorable', 'reserved ignorable'],
  ])('%j -> %j', (raw, want) => {
    expect(cleanDisplay(raw)).toBe(want);
  });

  it.each([undefined, null, 42, {}, [], '', '   ', '\u17B4', '\u180B\u180C\u180D\u180F', '\uFFF0\uFFF8', '\u{E01F0}', '\u202E\u200B', '\n\t'])('%j is nothing', (v) => {
    expect(cleanDisplay(v)).toBeNull();
  });

  it('caps by code points, never mid-character', () => {
    const long = '🏈'.repeat(MAX_DISPLAY_LENGTH + 20);
    const out = cleanDisplay(long)!;
    expect(Array.from(out)).toHaveLength(MAX_DISPLAY_LENGTH);
    expect(out).toBe('🏈'.repeat(MAX_DISPLAY_LENGTH));
    expect(cleanDisplay('x'.repeat(500))).toHaveLength(MAX_DISPLAY_LENGTH);
  });

  it('takes a shorter cap for an inviter (40), by code points', () => {
    expect(MAX_INVITER_LENGTH).toBe(40);
    expect(cleanDisplay('x'.repeat(100), MAX_INVITER_LENGTH)).toHaveLength(40);
    expect(Array.from(cleanDisplay('🏈'.repeat(100), MAX_INVITER_LENGTH)!)).toHaveLength(40);
    expect(cleanDisplay('roberto_b', MAX_INVITER_LENGTH)).toBe('roberto_b');
  });
});

describe('the sanitizer\'s source', () => {
  it('is pure ASCII: every invisible character is spelled as an escape, so a formatter that strips zero-width characters cannot weaken it', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/join/displayText.ts'), 'utf-8');
    const offending = [...src].filter((c) => c.charCodeAt(0) > 0x7f);
    expect(offending).toEqual([]);
    expect(src).toMatch(/\\u200B-\\u200F/); // the escapes are really there
  });
});

describe('the preview text is cleaned where it enters', () => {
  it('invite-preview: name and inviter', () => {
    const got = parseInvitePreview(200, { found: true, name: 'Stock\u202E Scudetto', inviter: 'x'.repeat(200), reason: null });
    expect(got).toMatchObject({ kind: 'found', name: 'Stock Scudetto' });
    expect(Array.from((got as { inviter: string }).inviter)).toHaveLength(MAX_INVITER_LENGTH); // 40 for an inviter, not 60
  });

  it('invite-preview: a name that is nothing but invisible characters is no league', () => {
    expect(parseInvitePreview(200, { found: true, name: '\u200B\u202E', inviter: null, reason: null })).toEqual({ kind: 'unknown' });
  });

  it('preview-league: the league name', () => {
    const l = parsePreviewLeague({ name: 'Bad\u202Ename', num_participants: 6 });
    expect(l?.name).toBe('Bad name');
    expect(parsePreviewLeague({ name: '\u200B', num_participants: 6 })).toBeNull();
  });

  it('join-league: the name that becomes "You\'re in {league}." is cleaned too (the one that used to slip through)', () => {
    const joined = interpretJoin({ ok: true, league: { id: 'L1', name: 'Bad\u202Ename\u200B' } }, null);
    expect(joined).toEqual({ kind: 'joined', leagueId: 'L1', leagueName: 'Bad name' });
    expect(Array.from((interpretJoin({ ok: true, league: { id: 'L1', name: 'x'.repeat(500) } }, null) as { leagueName: string }).leagueName)).toHaveLength(MAX_DISPLAY_LENGTH);
  });

  it('join-league: a name that is nothing but invisible characters is a failed read, never a blank headline', () => {
    expect(interpretJoin({ ok: true, league: { id: 'L1', name: '\u200B\u3164' } }, null)).toEqual({ kind: 'error', error: 'unreachable' });
  });

  it('a hostile response over the wire is cleaned too', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ found: true, name: 'A\u202EB', inviter: null, reason: null }), { status: 200 })) as typeof fetch;
    expect(await fetchInvitePreview('ABCDE23456', { fetchImpl, url: 'https://x.invalid/f' })).toMatchObject({ name: 'A B' });
  });
});
