/**
 * G-10 (pass-2b gate, §9A themes): the shared stock search (the draft room, the
 * queue editor, and the legacy callers) takes every colour from the theme, so in
 * Dark the field and its results are dark. Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';

const field = SOURCES['components/SymbolSearchField.tsx'];

Deno.test('the search field never imports the legacy light-only Colors (or its shadows)', () => {
  assertEquals(field.includes("from '@/constants/Colors'"), false);
  assertEquals(field.includes('Colors.'), false);
  assertEquals(field.includes("from '@/constants/theme'"), false);
  assertEquals(field.includes('const { colors, elevation } = useTheme();'), true);
});

Deno.test('the ruled tokens: field inset / text / text2 placeholder; results on a rimmed surface, no rule lines (§9C rule 2)', () => {
  assertEquals(field.includes('{ backgroundColor: colors.inset, color: colors.text, borderColor: colors.border }'), true);
  assertEquals(field.includes('placeholderTextColor={colors.text2}'), true);
  // The results, "no matches" and "didn't load" panels: surface + the card rim (elevation.card).
  assertEquals((field.match(/\{ backgroundColor: colors\.surface \}, elevation\.card/g) ?? []).length, 3);
  // gn-sweep: rows divide by space, never a line (no bottom border, no line token, no hairline).
  assertEquals(/borderBottomWidth|borderBottomColor|colors\.line|hairlineWidth/.test(field), false);
});

Deno.test('no caller passes its own colours into the field (theming it is safe for all of them)', () => {
  // (The legacy app/(tabs)/draft.tsx is a redirect since S-2; the orphaned TradeModal was deleted in W4.)
  for (const p of ['components/game/DraftRoom.tsx', 'components/game/QueueEditor.tsx']) {
    const src = SOURCES[p];
    const at = src.indexOf('<SymbolSearchField');
    const el = src.slice(at, src.indexOf('/>', at));
    assertEquals(at >= 0, true, p);
    assertEquals(/style=|Color=|colors\./.test(el), false, p);
  }
});

import { symbolsSearchFixture } from '../lib/game/seamFixtures.ts';

Deno.test('the capture seam\'s symbols-search: ticker or name prefix, limited, priced; empty query is empty', () => {
  assertEquals(symbolsSearchFixture({ q: 'a', limit: 8 }).items.map((i) => i.symbol), ['AAPL', 'AMD', 'AMZN', 'AVGO', 'ADBE', 'ABNB']);
  assertEquals(symbolsSearchFixture({ q: 'apple' }).items.map((i) => i.symbol), ['AAPL']);
  assertEquals(symbolsSearchFixture({ q: 'a', limit: 2 }).items.length, 2);
  assertEquals(symbolsSearchFixture({ q: '' }).items, []);
});

Deno.test('the seam is consulted only when on, in front of the real call the map sees (source guard)', () => {
  const hook = SOURCES['lib/useSymbolSearch.ts'];
  assertEquals(hook.includes("const fixture = SEAM_ON ? invokeFixtureFor('symbols-search', body) : null;"), true);
  // (In pieces: a whole invoke literal here would read as a call site to gen-architecture.)
  assertEquals(hook.includes('fixture ?? (await supabase'), true);
  assertEquals(hook.includes(".invoke('symbols-search', { body }))"), true);
});

Deno.test('the room\'s and the queue\'s search cards let the dropdown overflow, above what follows (source guard)', () => {
  for (const p of ['components/game/DraftRoom.tsx', 'components/game/QueueEditor.tsx']) {
    const src = SOURCES[p];
    assertEquals(src.includes("searchCard: { overflow: 'visible', zIndex: 10 },"), true, p);
    // The card that holds the field is the one that overflows.
    const at = src.indexOf('<SymbolSearchField');
    const card = src.lastIndexOf('<Card', at);
    assertEquals(src.slice(card, at).includes('styles.searchCard'), true, p);
  }
});

Deno.test('the tab scroll view lifts a focused field above the keyboard and lets a result tap select (source guard)', () => {
  const bars = SOURCES['components/shell/BarsRefresh.tsx'];
  assertEquals(bars.includes('automaticallyAdjustKeyboardInsets'), true);
  // Both the iOS and the Android scroll views pass taps through while the keyboard is up.
  assertEquals((bars.match(/keyboardShouldPersistTaps="handled"/g) ?? []).length, 2);
});
