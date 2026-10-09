/**
 * The sp Text resolves a caller's fontWeight to the matching Archivo face (iOS ignores
 * fontWeight on a single-weight family, so "bold" rendered Medium; found in the S-10
 * capture, 2026-10-08). Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { resolveFontFamily } from '../components/sp/logic/fontWeight.ts';
import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('a weight picks the Archivo face; no weight or another family is unchanged', () => {
  assertEquals(resolveFontFamily('Archivo-Medium', '700'), 'Archivo-Bold');
  assertEquals(resolveFontFamily('Archivo-Medium', 'bold'), 'Archivo-Bold');
  assertEquals(resolveFontFamily('Archivo-Medium', 600), 'Archivo-SemiBold');
  assertEquals(resolveFontFamily('Archivo-Medium', '800'), 'Archivo-ExtraBold');
  assertEquals(resolveFontFamily('Archivo-Medium', '900'), 'Archivo-ExtraBold');
  assertEquals(resolveFontFamily('Archivo-SemiBold', 'normal'), 'Archivo-Regular');
  assertEquals(resolveFontFamily('Archivo-Medium', undefined), 'Archivo-Medium');
  assertEquals(resolveFontFamily('Archivo-Condensed-Black', '700'), 'Archivo-Condensed-Black'); // one weight
  assertEquals(resolveFontFamily('Archivo-Expanded-ExtraBold', '500'), 'Archivo-Expanded-ExtraBold');
});

Deno.test('the sp Text applies it to the caller\'s style (source guard)', () => {
  const t = SOURCES['components/sp/Text.tsx'];
  assert(t.includes('const fontFamily = resolveFontFamily(typeStyle.fontFamily, callerWeight);'));
  assert(t.includes('fontFamily,'));
  // Every loaded face it can pick is registered.
  const layout = SOURCES['app/_layout.tsx'];
  for (const f of ['Archivo-Regular', 'Archivo-Medium', 'Archivo-SemiBold', 'Archivo-Bold', 'Archivo-ExtraBold']) assert(layout.includes(`'${f}': require(`), f);
});
