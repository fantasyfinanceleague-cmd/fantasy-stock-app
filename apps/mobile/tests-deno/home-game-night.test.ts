/**
 * W4 (plan docs/plans/2026-10-12-visual-language-reset.md; gate docs/design/reviews/
 * w4-gate-checklist.md): Home on the Game Night primitives and tokens (DESIGN_DIRECTION
 * §9C), both themes. Source guards for the rules a capture shows but a reskin can quietly
 * undo: your half shaded (never the leader's), every fill reading its own ink, tokens only.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';

const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join('\n');
const HOME_FILES = ['app/(tabs)/index.tsx', ...Object.keys(SOURCES).filter((p) => p.startsWith('components/home/'))];

Deno.test('shading B on This week: YOUR half is youTint in every state; the opponent half has no fill', () => {
  const card = code(SOURCES['components/home/ThisWeekCard.tsx']);
  // Your half: unconditional — not keyed on who leads.
  assert(card.includes('<View testID="this-week-you" style={[styles.half, styles.halfYou, { backgroundColor: colors.youTint }]}>'));
  // Theirs: position (the right half), never a fill.
  assert(card.includes('<View style={[styles.half, styles.halfOpp]}>'));
  // No leader-following shade anywhere on the card (Giorgio: "Not whoever's winning").
  assert(!/leader\s*===?\s*'you'\s*\?\s*\{?\s*backgroundColor/.test(card));
  assert(!card.includes('leadWash') && !card.includes('colors.lit'));
  // The scores are plain text (zero in grey), never coloured by side or by leader.
  assert(card.includes("preSeason || scoreTone(gain, side) === 'zero' ? colors.zero : colors.text"));
});

Deno.test('This week: your avatar ringed in `you`, theirs the slate `opp` in the same footprint', () => {
  const card = SOURCES['components/home/ThisWeekCard.tsx'];
  assert(card.includes('<Avatar name={youName} size={AVATAR} tone="you" ring />'));
  assert(card.includes('<Avatar name={opponentName} size={AVATAR} tone="opp" />'));
  assert(card.includes('padding: AVATAR_RING + AVATAR_RING_GAP,'));
  assertEquals(SOURCES['components/home/ThisWeekCard.tsx'].includes('const TUG_HEIGHT = 6;'), true);
});

Deno.test('chips are the §9C Chip: live = accentTint + liveText with the dot; others inset + text', () => {
  for (const f of ['components/home/ThisWeekCard.tsx', 'components/home/DraftingCard.tsx', 'components/home/PreDraftCard.tsx']) {
    assert(SOURCES[f].includes('chipLook('), f);
    assert(!/styles\.chip, \{ backgroundColor: colors\.inset \}/.test(SOURCES[f]), `${f}: a hand-coloured chip`);
  }
});

Deno.test('every fill reads its own ink (§9C rule 4): your fills are `you` + `onYou`', () => {
  const grid = SOURCES['components/home/TeamSoFarGrid.tsx'];
  assert(grid.includes('{ backgroundColor: colors.you }'));
  assert(grid.includes('color: colors.onYou'));
  assert(!grid.includes('colors.youText, borderColor') && !grid.includes('color: colors.surface'));
  const pre = SOURCES['components/home/PreDraftCard.tsx'];
  assert(pre.includes("<Avatar key={m.userId} name={m.displayName} size={AVATAR} tone={isYou ? 'you' : 'neutral'} />"));
  assert(pre.includes('i < memberCount ? colors.you : colors.track'));
});

Deno.test('Home uses tokens only: no colour literals, no text-transform style, no 999 or 14 radius literals', () => {
  for (const f of HOME_FILES) {
    const src = code(SOURCES[f]);
    assert(!/#[0-9A-Fa-f]{3,8}\b/.test(src), `${f}: a hex colour literal`);
    assert(!src.includes('rgba('), `${f}: an rgba literal`);
    assert(!src.includes('textTransform'), `${f}: textTransform (uppercase in JS)`);
    assert(!/borderRadius: (999|14|10),/.test(src), `${f}: a radius literal (radius.pill / .lg / .md)`);
  }
});

Deno.test('the season chart is the Game Night Chart, edge to edge, its two dates under the marks', () => {
  const chart = SOURCES['components/home/SeasonChart.tsx'];
  assert(chart.includes("import { Chart, type UnderRow } from '@/components/sp/gn';"));
  assert(!chart.includes('areaPath') && !chart.includes('ClipPath'), 'no fill under a Game Night line');
  assert(SOURCES['components/home/HomeSeason.tsx'].includes('bleed={space[6]}'));
});
