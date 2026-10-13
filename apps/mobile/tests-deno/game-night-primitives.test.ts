/**
 * The Game Night primitives' pure logic (§9C "Components (the W3 primitives)", with the
 * Design Lead's player-card order of 2026-10-12) and source guards on the components that
 * draw by it. Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { color } from '../constants/tokens/color.ts';
import {
  acquisitionLine, actionLabel, chipLook, draftTileLook, howTitle, litSide, movement, playerAction, rangeLook,
  scoreboardModel, sectorColorKey, SECTOR_LABEL, SECTOR_LINE, sinceLabel, toneOf, type Sector,
} from '../components/sp/logic/gameNight.ts';
import { SOURCES } from './sourceManifest.generated.ts';

const THEMES = ['light', 'dark'] as const;
const strip = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// ── Scoreboard ───────────────────────────────────────────────────────────────────

Deno.test('Scoreboard: the leader\'s half is lit and the line says "{name} leads by {margin}" / "won by"', () => {
  const you = { name: 'Roberto B.', gain: 343.59 };
  const opp = { name: 'Gianluigi B.', gain: 121.26 };
  assertEquals(scoreboardModel(you, opp, false), { leader: 'you', line: 'Roberto B. leads by $222.33' });
  assertEquals(scoreboardModel(you, opp, true).line, 'Roberto B. won by $222.33');
  assertEquals(scoreboardModel(opp, you, false), { leader: 'opp', line: 'Roberto B. leads by $222.33' });
  assertEquals(scoreboardModel({ ...you, gain: -10 }, { ...opp, gain: -40 }, false).leader, 'you'); // both down: the smaller loss leads
  assertEquals(scoreboardModel(you, { ...opp, gain: you.gain }, false), { leader: null, line: 'Dead even' });
});

Deno.test('Scoreboard: totals in score.xl, the lead wash on the leader only, your avatar ringed, nothing else', () => {
  const src = strip(SOURCES['components/sp/gn/Scoreboard.tsx']);
  assert(src.includes('variant="score.xl"'));
  assert(src.includes('lead ? { backgroundColor: colors.leadWash } : null'));
  assert(src.includes("ring={side === 'you'}"));
  assert(!/TugBar|Chyron|LiveDot|SeasonChart|Chart\b/.test(src), 'the Matchup header carries nothing else');
});

// ── RosterRow ────────────────────────────────────────────────────────────────────

Deno.test('RosterRow: the half that wins the row is lit; level or an empty side lights nothing', () => {
  assertEquals(litSide(41.26, 12.5), 'left');
  assertEquals(litSide(-3, 7), 'right');
  assertEquals(litSide(-3, -7), 'left'); // the smaller loss wins the row
  assertEquals(litSide(5, 5), null);
  assertEquals(litSide(5, null), null);
  assertEquals(toneOf(0), 'zero');
});

Deno.test('RosterRow: no sparkline, no row rule, the slab bleeds past the gutter with inner corners only', () => {
  const src = strip(SOURCES['components/sp/gn/RosterRow.tsx']);
  assert(!/Svg|Spark|Path|borderBottomWidth|borderTopWidth/.test(src), 'no line on rows');
  assert(src.includes('marginLeft: -gutter') && src.includes('marginRight: -gutter'));
  assert(src.includes('borderTopRightRadius: radius.row') && src.includes('borderTopLeftRadius: radius.row'));
  assert(src.includes('lit ? { backgroundColor: colors.lit } : null'));
  assert(src.includes('variant="score.md"'));
});

// ── DraftTile ────────────────────────────────────────────────────────────────────

Deno.test('DraftTile: a picked tile is `surface` with its sector as a 3pt LINE — never a sector fill', () => {
  assertEquals(SECTOR_LINE, 3);
  for (const theme of THEMES) {
    const c = color[theme];
    for (const s of Object.keys(SECTOR_LABEL) as Sector[]) {
      const look = draftTileLook('picked', s, c);
      assertEquals(look.fill, c.surface, `${theme} ${s}: fill`);
      assertEquals(look.line, c[sectorColorKey(s)], `${theme} ${s}: line`);
      assert(look.fill !== look.line, `${theme} ${s}: filled with its sector`);
      assertEquals(look.tickerInk, c.text);
      assertEquals(look.labelInk, c.text2);
    }
    assertEquals(draftTileLook('picked', null, c).line, null);
  }
});

Deno.test('DraftTile: the on-the-clock cell is `clockCell`, ringed, with its own ink; an empty cell is `sunken`', () => {
  for (const theme of THEMES) {
    const c = color[theme];
    assertEquals(draftTileLook('onClock', null, c), { fill: c.clockCell, line: null, ring: c.clockCellLive, labelInk: c.clockCellLive, tickerInk: c.onClockCell });
    assertEquals(draftTileLook('empty', null, c).fill, c.sunken);
  }
  assertEquals(SECTOR_LABEL.health, 'Hlth');
});

Deno.test('DraftTile: the component draws the line from the look, at the bottom', () => {
  const src = strip(SOURCES['components/sp/gn/DraftTile.tsx']);
  assert(src.includes('{ backgroundColor: look.fill }'));
  assert(src.includes('look.line ? <View testID="draft-tile-sector-line"'));
  assert(/line: \{\s*position: 'absolute',\s*left: 0,\s*right: 0,\s*bottom: 0,\s*height: SECTOR_LINE,/.test(src));
});

// ── ManagerRow ───────────────────────────────────────────────────────────────────

Deno.test('ManagerRow: movement is a drawn chevron + number; unchanged is an en dash', () => {
  assertEquals(movement(2), { dir: 'up', text: '2', a11y: 'up 2' });
  assertEquals(movement(-1), { dir: 'down', text: '1', a11y: 'down 1' });
  assertEquals(movement(0), { dir: 'none', text: '–', a11y: 'no change' });
  assertEquals(movement(null).dir, 'none');
});

Deno.test('ManagerRow: surface tiles 6pt apart, radius 12; your row tinted over the tile, ringed 1.5pt, no "(you)"', () => {
  const src = strip(SOURCES['components/sp/gn/ManagerRow.tsx']);
  assert(src.includes('export const MANAGER_ROW_GAP = 6;'));
  assert(src.includes('borderRadius: radius.row'));
  assert(src.includes('{ backgroundColor: colors.surface }'));
  assert(src.includes('backgroundColor: colors.youTint, borderColor: colors.you'));
  assert(src.includes('borderWidth: YOU_RING'));
  assert(src.includes('yourNameStyle(isYou)'));
  assert(!/borderBottomWidth|borderTopWidth/.test(src), 'rows divide by space, never rules');
});

// ── RangePills ───────────────────────────────────────────────────────────────────

Deno.test('RangePills: Home tabs underline in accent; money pills fill accent with onAccent ink', () => {
  for (const theme of THEMES) {
    const c = color[theme];
    assertEquals(rangeLook('tabs', true, c), { fill: null, ink: c.text, underline: c.accent });
    assertEquals(rangeLook('tabs', false, c), { fill: null, ink: c.text2, underline: null });
    assertEquals(rangeLook('pills', true, c), { fill: c.accent, ink: c.onAccent, underline: null });
    assertEquals(rangeLook('pills', false, c), { fill: null, ink: c.text2, underline: null });
  }
});

// ── Chip ─────────────────────────────────────────────────────────────────────────

Deno.test('Chip: live is accentTint + liveText with the dot; FINAL is inset + text', () => {
  for (const theme of THEMES) {
    const c = color[theme];
    assertEquals(chipLook('live', c), { fill: c.accentTint, ink: c.liveText, dot: c.live });
    assertEquals(chipLook('final', c), { fill: c.inset, ink: c.text, dot: null });
  }
  assert(SOURCES['components/sp/PhaseChip.tsx'].includes('chipLook('));
});

// ── Card / tab bar ───────────────────────────────────────────────────────────────

Deno.test('Card: surface + a 1pt rim, no shadow; the tab bar has no top rule', () => {
  const card = strip(SOURCES['components/sp/Card.tsx']);
  assert(card.includes('{ backgroundColor: colors.surface }'));
  assert(card.includes('borderColor: colors.rim'));
  assert(card.includes('borderWidth: RIM_WIDTH'));
  assert(!/shadow|LinearGradient/i.test(card));
  const tab = strip(SOURCES['components/shell/ShellTabBar.tsx']);
  assert(!/borderTop/.test(tab));
  assert(tab.includes('focused ? colors.accent : colors.text2'));
});

// ── PlayerCard ───────────────────────────────────────────────────────────────────

Deno.test('PlayerCard: your stock → Sell (disabled with the reason while closed), never Save; theirs → Save / Saved', () => {
  assertEquals(playerAction('you', true, false, 'Mon 9:30 ET'), { kind: 'sell', enabled: true });
  assertEquals(playerAction('you', false, false, 'Mon 9:30 ET'), { kind: 'sell', enabled: false, note: "Market's closed. Opens Mon 9:30 ET." });
  assertEquals(playerAction('you', true, true, 'x').kind, 'sell'); // a saved flag never turns yours into Save
  assertEquals(actionLabel(playerAction('other', true, false, 'x')), 'Save');
  assertEquals(actionLabel(playerAction('other', false, true, 'x')), 'Saved');
});

Deno.test('PlayerCard: "How you got it" lines in Giorgio\'s words; "Since the draft" or "Since {date}"', () => {
  assertEquals(acquisitionLine({ kind: 'drafted', pick: 2, date: 'Sep 29', price: 290.1 }), 'Drafted 2nd overall · Sep 29 · $290.10');
  assertEquals(acquisitionLine({ kind: 'claimed', date: 'Oct 7', price: 187.2 }), 'Claimed off waivers · Oct 7 · $187.20');
  assertEquals(acquisitionLine({ kind: 'bought', date: 'Oct 2', price: 214.8 }), 'Bought · Oct 2 · $214.80');
  assertEquals(sinceLabel({ kind: 'drafted', pick: 1, date: 'Sep 29', price: 1 }), 'Since the draft');
  assertEquals(sinceLabel({ kind: 'drafted', pick: 1, date: 'Sep 29', price: 1 }, 'Season gain'), 'Season gain');
  assertEquals(sinceLabel({ kind: 'bought', date: 'Oct 2', price: 1 }), 'Since Oct 2');
  assertEquals(howTitle('you'), 'How you got it');
  assertEquals(howTitle('other'), 'How they got it');
});

Deno.test('PlayerCard: the order — header, three figures, season (dated), this week (Mon…Fri), action, How you got it, credit', () => {
  const src = strip(SOURCES['components/sp/gn/PlayerCard.tsx']);
  const at = (s: string) => {
    const i = src.indexOf(s);
    assert(i >= 0, `missing: ${s}`);
    return i;
  };
  const order = [
    at('variant="ticker.card"'),
    at('label="Price"'),
    at('label="Week gain"'),
    at('label={sinceLabel('),
    at('axis={season.axis}'),
    at("axis={{ kind: 'week' }}"),
    at('testID="player-card-action"'),
    at('howTitle('),
    at('MONEY_COPY.alpacaCredit'),
  ];
  assertEquals(order, [...order].sort((a, b) => a - b));
  assertEquals((src.match(/<Figure /g) ?? []).length, 3, 'three key figures, no position');
  assert(!/position/i.test(src.replace(/position: 'absolute'/g, '')), 'no position figure');
  assert(!/marks=|<Circle|'Drafted'/.test(src), 'no acquisition marker on the chart');
  assert(!/marks/.test(strip(SOURCES['components/sp/gn/Chart.tsx'])), 'the Chart takes no marker');
});

// ── Chart ────────────────────────────────────────────────────────────────────────

Deno.test('Chart: one 2.5pt line coloured by the window, a dashed borderStrong base, no fill, no grid, an X axis', () => {
  const src = strip(SOURCES['components/sp/gn/Chart.tsx']);
  assert(src.includes('const STROKE = 2.5;'));
  assert(src.includes('stroke={colors.borderStrong} strokeWidth={1} strokeDasharray="3 5"'));
  assert(src.includes('const lineColor = colors[tone];'));
  assert(src.includes('fill={colors.liveGlow}') && src.includes('const HALO_R = 9;'));
  assert(!/areaPath|ClipPath|fillOpacity|LinearGradient/.test(src), 'no fill');
  assert(src.includes('layoutAxis('), 'the X axis');
  assert(src.includes('variant="caption" tone="secondary"'), 'axis labels: caption, text2');
});
