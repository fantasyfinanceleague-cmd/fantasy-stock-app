/**
 * The pre-draft Home's Members card at XXXL (Design Lead P2, 2026-10-19). "Members · 6 of 8 joined" ran together and clipped at the card's edge
 * ("6 of 8 joine…"), and the dashed "+2" disc clipped its text. The rules: the header row wraps (the value drops under the label, to the left);
 * the "+N" text takes the chips' own multiplier (type.tag.maxScale) and the disc GROWS if it cannot hold it, never clipping. At Large the disc is the same
 * 36pt circle and the header the same single line (pixel-identical: the captures). Source pins; the layout needs a device.
 * Run: `cd apps/mobile/tests-deno && deno test --allow-read .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';
import { type as TYPE } from '../constants/tokens/type.ts';

/** Source without comments, so a pin never passes on a comment that names the thing. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}
const card = code(SOURCES['components/home/PreDraftCard.tsx']);

/** The body of one `name: { ... }` entry of the card's StyleSheet. */
function style(name: string): string {
  const at = card.indexOf(`  ${name}: {`);
  assert(at >= 0, `a ${name} style`);
  return card.slice(at, card.indexOf('\n  },', at));
}

Deno.test('the Members header wraps: the value drops under the label (to the left) instead of running past the card edge', () => {
  const header = style('sectionHeader');
  assert(/flexDirection: 'row'/.test(header), 'still one row while it fits');
  assert(/flexWrap: 'wrap'/.test(header), 'it wraps');
  assert(/justifyContent: 'space-between'/.test(header), 'space-between: a wrapped value on its own line starts at the left');
  assert(/columnGap: space\[3\]/.test(header) && /rowGap: space\[1\]/.test(header), 'a gap between label and value on a line, a small one between the lines');
  assert(card.includes('<View style={styles.sectionHeader}>') && card.includes('{MEMBERS_TITLE}'), 'it is the Members header');
  // The text is not shrunk or truncated to make it fit.
  const headerJsx = card.slice(card.indexOf('<View style={styles.sectionHeader}>'), card.indexOf('<View style={styles.membersRow}>'));
  assert(!/numberOfLines|ellipsizeMode|adjustsFontSizeToFit/.test(headerJsx), 'no truncation or shrink-to-fit on the header text');
});

Deno.test('the "+N" disc: its text takes the chips\' cap, and the disc is a minimum size that grows, never a fixed box that clips', () => {
  assert(card.includes('export const PLUS_MAX_SCALE = typeScale.tag.maxScale;'), 'the cap IS the tag token\'s maxScale');
  assertEquals(TYPE.tag.maxScale, 1.4);
  assert(code(SOURCES['components/sp/PhaseChip.tsx']).includes('maxFontSizeMultiplier={tagStyle.maxScale}'), 'the chips use that token');
  assert(/<Text variant="callout" tone="secondary" maxFontSizeMultiplier=\{PLUS_MAX_SCALE\}>\s*\+\{overflow\}/.test(card), 'the "+N" text carries the cap');
  const disc = style('plusDisc');
  assert(/minWidth: AVATAR/.test(disc) && /minHeight: AVATAR/.test(disc), 'the disc is AT LEAST the avatar size (36pt at Large: the same circle)');
  assert(!/(^|[\s{,])width:/.test(disc) && !/(^|[\s{,])height:/.test(disc), 'and has no fixed width or height to clip into');
  assert(/borderRadius: AVATAR \/ 2/.test(disc), 'a circle at 36pt; a pill once it grows');
  assert(/paddingHorizontal: space\[1\]/.test(disc), 'a little room either side once it grows');
  assert(/borderStyle: 'dashed'/.test(disc) && /borderWidth: 1\.5/.test(disc), 'still the dashed 1.5pt outline');
  assert(card.includes('<View style={[styles.plusDisc, { borderColor: colors.borderStrong }]}>'), 'the "+N" disc uses it');
  assert(!card.includes('styles.avatarDashed'), 'not the old fixed-size dashed avatar');
});

Deno.test('the real avatars keep their fixed 36pt (only the "+N" disc grows)', () => {
  assert(/const AVATAR = 36;/.test(card));
  assert(card.includes('size={AVATAR}'), 'the avatars take the size');
});
