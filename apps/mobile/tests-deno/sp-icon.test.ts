/**
 * <Icon> logic (DESIGN_DIRECTION §9B): the exhaustive semantic-name map, the
 * size by role, the Dynamic Type scaling capped at the role's maxScale, and the
 * accessibility rule (decorative by default; a label makes it accessible).
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  ICON_GLYPHS, ICON_SIZE, iconPointSize, iconAccessibility, medallionDiscPt, type IconName,
} from '../components/sp/logic/icon.ts';

const NAMES: IconName[] = [
  'chevronRight', 'chevronLeft', 'chevronDown', 'chevronUp', 'check', 'circle', 'info',
  'close', 'search', 'add', 'share', 'trophy', 'lock', 'mail', 'alert',
];

Deno.test('the name map is exhaustive and matches the spec table', () => {
  assertEquals(Object.keys(ICON_GLYPHS).sort(), [...NAMES].sort());
  assertEquals(ICON_GLYPHS.chevronRight, 'chevron-forward');
  assertEquals(ICON_GLYPHS.chevronLeft, 'chevron-back');
  assertEquals(ICON_GLYPHS.chevronDown, 'chevron-down');
  assertEquals(ICON_GLYPHS.chevronUp, 'chevron-up');
  assertEquals(ICON_GLYPHS.check, 'checkmark');
  assertEquals(ICON_GLYPHS.circle, 'ellipse-outline');
  assertEquals(ICON_GLYPHS.info, 'information-circle-outline');
  assertEquals(ICON_GLYPHS.share, 'share-outline');
  assertEquals(ICON_GLYPHS.lock, 'lock-closed-outline');
  assertEquals(ICON_GLYPHS.mail, 'mail-outline');
});

Deno.test('outline by default: no glyph is a filled variant (filled is only for a selected state)', () => {
  for (const g of Object.values(ICON_GLYPHS)) {
    assertEquals(g.includes('filled'), false, g);
  }
});

Deno.test('size by role: 14 / 16 / 18 / 20 / 24 pt', () => {
  assertEquals(ICON_SIZE, { caption: 14, callout: 16, body: 18, headline: 20, title: 24, medallion: 36 });
});

Deno.test('the icon scales with Dynamic Type, never below its size, capped at the role', () => {
  assertEquals(iconPointSize('callout', 1), 16);
  assertEquals(iconPointSize('callout', 1.3), 20.8);
  assertEquals(iconPointSize('caption', 3), 19.6); // caption's ceiling is 1.4
  assertEquals(iconPointSize('callout', 0.8), 16); // never shrinks
});

Deno.test('decorative by default: hidden from VoiceOver with no label', () => {
  assertEquals(iconAccessibility(undefined), { accessible: false, hidden: true, label: undefined });
  assertEquals(iconAccessibility('   '), { accessible: false, hidden: true, label: undefined });
});

Deno.test('a label makes it accessible and carries that label', () => {
  assertEquals(iconAccessibility('Back'), { accessible: true, hidden: false, label: 'Back' });
});

Deno.test('alert is the load-failure icon (alert-circle-outline)', () => {
  assertEquals(ICON_GLYPHS.alert, 'alert-circle-outline');
});

Deno.test('the medallion: a 36 pt glyph in a 72 pt disc at standard size', () => {
  assertEquals(iconPointSize('medallion', 1), 36);
  assertEquals(medallionDiscPt(1), 72);
});

Deno.test('the medallion scales with Dynamic Type to the heading factor, capped at 1.3x (47 / 94 pt)', () => {
  assertEquals(iconPointSize('medallion', 1.3), 47);
  assertEquals(medallionDiscPt(1.3), 94);
  assertEquals(iconPointSize('medallion', 2.5), 47); // capped
  assertEquals(medallionDiscPt(2.5), 94);
});
