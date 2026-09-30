/**
 * Hermetic unit tests for components/sp/logic/avatar.ts — no RN, run with:
 *
 *   deno test apps/mobile/tests-deno/
 *
 * Design Lead, 2026-09-29 (DESIGN-CHANGES follow-up): the fallback initial
 * ("P", "G", or the neutral "?") is a glyph inside a fixed-diameter circle,
 * not running text — at accessibility-XL it scaled with Dynamic Type and
 * clipped past the circle (visible in the xl-03 capture). Fixed by sizing
 * it proportionally to the circle's own `size` instead of a fixed type
 * token, and disabling font scaling on it entirely (Avatar.tsx passes
 * allowFontScaling={false} — not testable here without an RN renderer, but
 * this pins the proportional-sizing half of the fix).
 */
import { assertEquals } from 'jsr:@std/assert';
import { initialFontSize, INITIAL_FONT_RATIO } from '../components/sp/logic/avatar.ts';

Deno.test('initialFontSize: scales with the circle, not a fixed value', () => {
  assertEquals(initialFontSize(36), Math.round(36 * INITIAL_FONT_RATIO));
  assertEquals(initialFontSize(72), Math.round(72 * INITIAL_FONT_RATIO));
});

Deno.test('initialFontSize: a larger avatar gets a larger initial, never the same fixed size', () => {
  const small = initialFontSize(24);
  const large = initialFontSize(64);
  assertEquals(large > small, true);
});

Deno.test('initialFontSize: at the component default (36), matches the pinned 0.4 ratio (14pt)', () => {
  assertEquals(initialFontSize(36), 14);
});

Deno.test('initialFontSize: rounds to a whole pixel rather than a fractional font size', () => {
  assertEquals(Number.isInteger(initialFontSize(37)), true);
});

// ── Two initials (Design Lead ruling, Phase 3b-1) ─────────────────────────

import { avatarInitials } from '../components/sp/logic/avatar.ts';

Deno.test('avatarInitials: first letter of the first word + first letter of the last word', () => {
  assertEquals(avatarInitials('Roberto B.'), 'RB');
  assertEquals(avatarInitials('Gianluigi Buffon'), 'GB');
  assertEquals(avatarInitials('maria de la cruz'), 'MC');
});

Deno.test('avatarInitials: usernames split on _ . - too ("roberto_b" reads RB, like the board)', () => {
  assertEquals(avatarInitials('roberto_b'), 'RB');
  assertEquals(avatarInitials('rob.bianchi'), 'RB');
  assertEquals(avatarInitials('ann-marie'), 'AM');
});

Deno.test('avatarInitials: one word → one letter; nothing usable → "?"', () => {
  assertEquals(avatarInitials('Roberto'), 'R');
  assertEquals(avatarInitials('roberto26'), 'R');
  assertEquals(avatarInitials(''), '?');
  assertEquals(avatarInitials('   '), '?');
  assertEquals(avatarInitials('___'), '?');
});

Deno.test('avatarInitials: an email falls back to its local part', () => {
  assertEquals(avatarInitials('roberto.bianchi@example.com'), 'RB');
});

Deno.test('avatarInitials: two letters still fit the smallest avatar (28 pt → 11 pt glyphs)', () => {
  // 2 capitals at ≈0.62 em wide each must stay inside the circle's inner 80%.
  const size = 28;
  const twoLettersWidth = 2 * 0.62 * initialFontSize(size);
  assertEquals(twoLettersWidth <= size * 0.8, true);
});
