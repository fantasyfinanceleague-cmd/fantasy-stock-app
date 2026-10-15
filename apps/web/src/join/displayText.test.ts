import { describe, expect, it } from 'vitest';
import { cleanDisplay, MAX_DISPLAY_LENGTH } from './displayText';
import { fetchInvitePreview, parseInvitePreview } from './invitePreview';
import { parsePreviewLeague } from './previewData';

describe('cleanDisplay: text from outside, dropped into our own headline templates', () => {
  it.each([
    ['Stock Scudetto', 'Stock Scudetto'],
    ['  Stock   Scudetto \n', 'Stock Scudetto'],
    ['Wall\tStreet', 'Wall Street'],
    ['Bold‮evil', 'Bold evil'], // right-to-left override
    ['a⁦b⁩c', 'a b c'], // isolates
    ['zero​width', 'zero width'],
    ['﻿bom', 'bom'],
    ['ctrl\u0007bell', 'ctrl bell'],
    ['Émile 🏈 FC', 'Émile 🏈 FC'],
  ])('%j -> %j', (raw, want) => {
    expect(cleanDisplay(raw)).toBe(want);
  });

  it.each([undefined, null, 42, {}, [], '', '   ', '‮​', '\n\t'])('%j is nothing', (v) => {
    expect(cleanDisplay(v)).toBeNull();
  });

  it('caps by code points, never mid-character', () => {
    const long = '🏈'.repeat(MAX_DISPLAY_LENGTH + 20);
    const out = cleanDisplay(long)!;
    expect(Array.from(out)).toHaveLength(MAX_DISPLAY_LENGTH);
    expect(out).toBe('🏈'.repeat(MAX_DISPLAY_LENGTH));
    expect(cleanDisplay('x'.repeat(500))).toHaveLength(MAX_DISPLAY_LENGTH);
  });
});

describe('the preview text is cleaned where it enters', () => {
  it('invite-preview: name and inviter', () => {
    const got = parseInvitePreview(200, { found: true, name: 'Stock‮ Scudetto', inviter: 'x'.repeat(200), reason: null });
    expect(got).toMatchObject({ kind: 'found', name: 'Stock Scudetto' });
    expect(Array.from((got as { inviter: string }).inviter)).toHaveLength(MAX_DISPLAY_LENGTH);
  });

  it('invite-preview: a name that is nothing but invisible characters is no league', () => {
    expect(parseInvitePreview(200, { found: true, name: '​‮', inviter: null, reason: null })).toEqual({ kind: 'unknown' });
  });

  it('preview-league: the league name', () => {
    const l = parsePreviewLeague({ name: 'Bad‮name', num_participants: 6 });
    expect(l?.name).toBe('Bad name');
    expect(parsePreviewLeague({ name: '​', num_participants: 6 })).toBeNull();
  });

  it('a hostile response over the wire is cleaned too', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ found: true, name: 'A‮B', inviter: null, reason: null }), { status: 200 })) as typeof fetch;
    expect(await fetchInvitePreview('ABCDE23456', { fetchImpl, url: 'https://x.invalid/f' })).toMatchObject({ name: 'A B' });
  });
});
