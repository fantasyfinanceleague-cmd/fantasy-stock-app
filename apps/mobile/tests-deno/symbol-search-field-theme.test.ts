/**
 * G-10 (UX audit pass 2b, §9A themes): the shared stock search takes every colour
 * from the theme, so in Dark the field and its results are dark. Lifted to main
 * ahead of the League-setup branch so other branches build on the themed field;
 * that branch carries the same guard over its own callers (symbol-search-theme.test.ts).
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import field from '../components/SymbolSearchField.tsx' with { type: 'text' };
import tradeModal from '../components/TradeModal.tsx' with { type: 'text' };
import legacyDraft from '../app/(tabs)/draft.tsx' with { type: 'text' };

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

Deno.test("no caller on main passes its own colours into the field", () => {
  for (const [p, src] of [['components/TradeModal.tsx', tradeModal], ['app/(tabs)/draft.tsx', legacyDraft]] as const) {
    const at = src.indexOf('<SymbolSearchField');
    const el = src.slice(at, src.indexOf('/>', at));
    assertEquals(at >= 0, true, p);
    assertEquals(/style=|Color=|colors\./.test(el), false, p);
  }
});
