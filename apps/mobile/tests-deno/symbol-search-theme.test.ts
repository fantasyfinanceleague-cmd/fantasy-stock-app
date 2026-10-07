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

Deno.test('the ruled tokens: field inset / text / text2 placeholder; results surface with line dividers', () => {
  assertEquals(field.includes('{ backgroundColor: colors.inset, color: colors.text, borderColor: colors.border }'), true);
  assertEquals(field.includes('placeholderTextColor={colors.text2}'), true);
  assertEquals(field.includes('{ backgroundColor: colors.surface, borderColor: colors.line }, elevation.card'), true);
  assertEquals(field.includes('{ borderBottomColor: colors.line }'), true);
});

Deno.test('no caller passes its own colours into the field (theming it is safe for all four)', () => {
  for (const p of ['components/game/DraftRoom.tsx', 'components/game/QueueEditor.tsx', 'components/TradeModal.tsx', 'app/(tabs)/draft.tsx']) {
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
