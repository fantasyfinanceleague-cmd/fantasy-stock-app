/**
 * Home's season-complete card at XXXL (Design Lead P2, 2026-10-19). Two truncations:
 *  - "See the final standings" showed as "See the fi…": a ListRow title was numberOfLines 1.
 *  - the hero "Champion" showed as "Champ…": score.lg at a 2.4× ceiling (67pt) is wider than the card.
 * The rules: a BUTTON label never truncates (it wraps, at a Button label's own ceiling); the hero line is the card's TAG, so it takes the
 * chips' own multiplier and shows whole. These are source pins (the layout needs a device; the stills are in the capture README).
 * Run: `cd apps/mobile/tests-deno && deno test --allow-read .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';
import { type as TYPE } from '../constants/tokens/type.ts';

/** Source without comments, so a pin never passes on a comment that names the thing. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}
function src(path: string): string {
  const s = SOURCES[path];
  assert(s !== undefined, `${path} is in the source manifest`);
  return code(s);
}
const num = (text: string, re: RegExp): number => Number(re.exec(text)?.[1]);

Deno.test('the hero line ("Champion", "2nd place") is the card\'s tag: it takes the chips\' own ceiling, so it shows whole', () => {
  const card = src('components/home/SeasonCompleteCard.tsx');
  assert(card.includes('export const HERO_MAX_SCALE = typeScale.tag.maxScale;'), 'the hero cap IS the tag token\'s maxScale (the one PhaseChip uses)');
  assertEquals(TYPE.tag.maxScale, 1.4, 'the chips\' ceiling');
  assert(src('components/sp/PhaseChip.tsx').includes('maxFontSizeMultiplier={tagStyle.maxScale}'), 'and the chips really use that token');
  const heroes = card.match(/<Text variant="score\.lg"[^>]*>/g) ?? [];
  assertEquals(heroes.length, 2, 'both hero lines (a participant\'s place, a non-participant\'s champion)');
  for (const h of heroes) {
    assert(h.includes('maxFontSizeMultiplier={HERO_MAX_SCALE}'), `a hero line carries the chip cap: ${h.slice(0, 70)}`);
    assert(!/maxFontSizeMultiplier=\{2\.4\}/.test(h), 'no 2.4× ceiling (the one that truncated "Champion")');
  }
  assert(!card.includes('maxFontSizeMultiplier={2.4}'), 'no 2.4× ceiling left anywhere in the card');
  // A name is not a chip: it wraps (a champion's display name is up to 20 characters).
  assert(/variant="score\.lg" maxFontSizeMultiplier=\{HERO_MAX_SCALE\} numberOfLines=\{0\}/.test(card), 'a non-participant\'s champion NAME wraps rather than truncating');
});

Deno.test('S3 as arithmetic: the hero title is never smaller than its subtitle at the largest sizes', () => {
  const card = src('components/home/SeasonCompleteCard.tsx');
  const hero = num(card, /export const SUBTITLE_MAX_SCALE = ([\d.]+);/);
  assert(hero > 0, 'SUBTITLE_MAX_SCALE exists');
  const title = TYPE["score.lg"].fontSize * (TYPE.tag.maxScale ?? 1);
  const subtitle = TYPE.callout.fontSize * hero;
  assert(subtitle <= title * 0.8, `the title (${title}pt) clearly outranks its subtitle (${subtitle}pt, at most 80% of it): the S3 rule, with room`);
  assert(subtitle >= TYPE.callout.fontSize * 1.6, 'but the subtitle is not squeezed below a readable growth (≥ 1.6×)');
  const subs = card.match(/<Text variant="callout" maxFontSizeMultiplier=\{SUBTITLE_MAX_SCALE\}>/g) ?? [];
  assertEquals(subs.length, 2, 'both subtitle lines carry the cap');
});

Deno.test('"See the final standings" is a button row: its title wraps at a Button label\'s ceiling, never truncating', () => {
  const card = src('components/home/SeasonCompleteCard.tsx');
  assert(/<ListRow title=\{SEE_FINAL_STANDINGS\} wrapTitle onPress=/.test(card), 'the row opts into wrapping');
  const row = src('components/sp/ListRow.tsx');
  assert(row.includes('numberOfLines={wrapTitle ? undefined : 1}'), 'wrapTitle drops the single-line limit; data rows keep it');
  assert(row.includes('maxFontSizeMultiplier={wrapTitle ? BUTTON_ROW_MAX_SCALE : undefined}'), 'a wrapping title is capped');
  assert(row.includes('export const BUTTON_ROW_MAX_SCALE = typeScale.headline.maxScale;'), 'at the Button label\'s own ceiling');
  assert(src('components/sp/Button.tsx').includes("variant={size === 'md' ? 'headline' : 'callout'}"), 'a Button label is `headline` (capped by that token)');
  assertEquals(TYPE.headline.maxScale, 1.6);
  // Data rows are untouched: the default is still one line.
  assert(/numberOfLines=\{wrapTitle \? undefined : 1\}/.test(row) && !/wrapTitle\s*=\s*true/.test(row), 'the default is false');
});

Deno.test('A Button label never truncates: no line limit and no ellipsize on the label, and none on Home\'s own button text', () => {
  const button = src('components/sp/Button.tsx');
  const label = button.slice(button.indexOf('<Text'), button.indexOf('</Text>'));
  assert(label.includes('variant={size'), 'found the label Text');
  assert(!/numberOfLines|ellipsizeMode|adjustsFontSizeToFit/.test(label), 'the label Text has no numberOfLines / ellipsizeMode / shrink-to-fit');
  for (const f of Object.keys(SOURCES).filter((p) => p.startsWith('components/home/') && p.endsWith('.tsx'))) {
    assert(!/ellipsizeMode/.test(code(SOURCES[f])), `${f}: no ellipsizeMode on Home`);
  }
});

Deno.test('Every Home button is a <Button> (so it wraps) or the wrapTitle row: no raw single-line pressable label', () => {
  const home = Object.keys(SOURCES).filter((p) => p.startsWith('components/home/') && p.endsWith('.tsx'));
  for (const f of home) {
    const s = code(SOURCES[f]);
    for (const m of s.matchAll(/<ListRow\b[^>]*onPress=/g)) {
      assert(/wrapTitle/.test(m[0]), `${f}: a ListRow button row must wrapTitle: ${m[0].slice(0, 80)}`);
    }
  }
});
