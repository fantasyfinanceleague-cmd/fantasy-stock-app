/**
 * W4 DL gate: a holding row's "{company} · {N} sh" was ONE numberOfLines={1} string, so a long
 * company truncated the share count with it. The company and " · N sh" are two Texts: the
 * company shrinks and truncates, the share count never does. Money values at 700 (800 is for
 * game numbers, §9C rule 5). HoldingRow is a React Native component, so this is a source guard
 * (the suite's established pattern).
 */
import { assertEquals } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';

const src = SOURCES['components/money/HoldingRow.tsx'];

function textBlock(testID: string): string {
  const at = src.indexOf(`testID="${testID}"`);
  return src.slice(src.lastIndexOf('<Text', at), src.indexOf('</Text>', at));
}

Deno.test('the company and the share count are separate Texts; never one joined string', () => {
  assertEquals(src.includes('${row.name} · ${row.quantityText}'), false);
  assertEquals(textBlock('holding-row-company').includes('{row.name}'), true);
  assertEquals(textBlock('holding-row-shares').includes('row.quantityText'), true);
});

Deno.test('the company shrinks and truncates; the share count never shrinks', () => {
  assertEquals(textBlock('holding-row-company').includes('numberOfLines={1}'), true);
  assertEquals(textBlock('holding-row-company').includes('styles.company'), true);
  assertEquals(textBlock('holding-row-shares').includes('styles.shares'), true);
  assertEquals(/company: \{\s*flexShrink: 1/.test(src), true);
  assertEquals(/shares: \{\s*flexShrink: 0/.test(src), true);
});

Deno.test('money values at 700, not the game numbers\' 800', () => {
  assertEquals(/money: \{\s*fontWeight: '700'/.test(src), true);
  assertEquals(src.includes('{row.valueText}') && src.includes('style={styles.money}>{row.valueText}'), true);
});
