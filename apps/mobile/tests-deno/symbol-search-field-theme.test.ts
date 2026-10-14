/**
 * G-10 (UX audit pass 2b, §9A themes): the shared stock search takes every colour
 * from the theme, so in Dark the field and its results are dark. Lifted to main
 * ahead of the League-setup branch so other branches build on the themed field;
 * that branch carries the same guard over its own callers (symbol-search-theme.test.ts).
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import field from '../components/SymbolSearchField.tsx' with { type: 'text' };
import draftRoom from '../components/game/DraftRoom.tsx' with { type: 'text' };

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

Deno.test("no caller on main passes its own colours into the field", () => {
  // (The legacy app/(tabs)/draft.tsx is a redirect since S-2; the orphaned TradeModal, this
  // test's old subject, was deleted in W4 Portfolio: nothing imported it.)
  for (const [p, src] of [['components/game/DraftRoom.tsx', draftRoom]] as const) {
    const at = src.indexOf('<SymbolSearchField');
    const el = src.slice(at, src.indexOf('/>', at));
    assertEquals(at >= 0, true, p);
    assertEquals(/style=|Color=|colors\./.test(el), false, p);
  }
});
