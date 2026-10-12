/**
 * A calm Home (Giorgio, option A, 2026-10-12; PRODUCT_RULES "A calm Home"; build spec
 * in docs/design/reviews/ux-audit-2026-10.md). Pure rules (lib/home/calmHome.ts) and the
 * source guards that keep each one wired: team value is the ONE standout number; This
 * week and Standings tap through; one primary when the season is over; the countdown
 * leads before the draft; the hero's sub-line is unchanged. The 24pt gap is pinned in
 * home-section-gap.test.ts, the chart's marks in home-week-marks.test.ts.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import {
  THIS_WEEK_HREF, STANDINGS_HREF, OPENS_MATCHUP_HINT, leagueSegmentFromParam, seasonOverPrimary, preDraftBlocks, preDraftChipShown,
  type PreDraftFlags,
} from '../lib/home/calmHome.ts';
import { HERO_SEASON_GAIN_LABEL, HERO_TODAY_LABEL, LIVE_CHIP } from '../lib/home/homeCopy.ts';
import { SOURCES } from './sourceManifest.generated.ts';

const home = SOURCES['app/(tabs)/index.tsx'];
const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const variants = (src: string, v: string) => (code(src).match(new RegExp(`variant="${v.replace('.', '\\.')}"|size="${v.replace('.', '\\.')}"`, 'g')) ?? []).length;

// ── One big number ─────────────────────────────────────────────────────────

Deno.test('in season, team value is the only big number: This week scores are score.md (28pt) in every state', () => {
  const card = SOURCES['components/home/ThisWeekCard.tsx'];
  assertEquals(variants(card, 'score.md'), 2);
  assertEquals(variants(card, 'score.lg') + variants(card, 'score.xl'), 0);
  // The skeleton matches the 28pt scores, so nothing jumps when they land.
  assertEquals((card.match(/<Skeleton width="70%" height=\{28\} \/>/g) ?? []).length, 2);
  // Standings and the chart block have no score type at all.
  for (const f of ['components/home/StandingsCard.tsx', 'components/home/HomeSeason.tsx', 'components/home/SeasonChart.tsx']) {
    assertEquals(variants(SOURCES[f], 'score.md') + variants(SOURCES[f], 'score.lg') + variants(SOURCES[f], 'score.xl'), 0, f);
  }
  // The hero's value is the one score.xl.
  assertEquals(variants(SOURCES['components/home/HomeHero.tsx'], 'score.xl'), 1);
});

Deno.test('before the draft, the countdown is the one big number (score.xl); the date is callout 700', () => {
  const card = SOURCES['components/home/PreDraftCard.tsx'];
  assert(card.includes("case 'countdown':\n        return <Text variant=\"score.xl\" style={styles.countdown}>{clock}</Text>;"));
  assert(card.includes("case 'date':\n        return <Text variant=\"callout\" style={styles.bold}>{dateLabel}</Text>;"));
  assertEquals(variants(card, 'score.xl'), 1);
  assertEquals(variants(card, 'score.lg') + variants(card, 'score.md'), 0);
});

// ── The hero is unchanged ──────────────────────────────────────────────────

Deno.test('the hero sub-line is unchanged: "+$X · +Y% season gain · +$Z today"', () => {
  assertEquals(HERO_SEASON_GAIN_LABEL, 'season gain');
  assertEquals(HERO_TODAY_LABEL, 'today');
  const hero = SOURCES['components/home/HomeHero.tsx'];
  const subLine = [
    '<RollingMoney text={gainDollarsText} size="callout" color={gainColor} rollKey={leagueId} />',
    '<Text variant="callout" style={{ color: gainColor }}> · </Text>',
    '<RollingMoney text={gainPctText} size="callout" color={gainColor} rollKey={leagueId} />',
    '<Text variant="callout" tone="secondary"> {HERO_SEASON_GAIN_LABEL}</Text>',
    '<Text variant="callout" tone="secondary"> · </Text>',
    '<RollingMoney text={todayText} size="callout" color={todayColor} rollKey={leagueId} />',
    '<Text variant="callout" tone="secondary"> {HERO_TODAY_LABEL}</Text>',
  ];
  let at = 0;
  for (const piece of subLine) {
    const i = hero.indexOf(piece, at);
    assert(i > at, `hero sub-line piece missing or out of order: ${piece}`);
    at = i;
  }
  assert(hero.includes('<RollingMoney text={valueText} size="score.xl" rollKey={leagueId} />'));
});

Deno.test('the hero block: HomeHero, then the chart and range tabs, 8pt apart; pre-season stays hero only', () => {
  assert(home.includes('<View style={{ gap: space[3] }}>\n          {hero}\n          <HomeSeason'));
  assert(home.includes("const showSeason = !!season && !['pre_season'].includes(phase.kind);"));
  assert(home.includes(') : hero}'));
  // The Season card is gone from Home.
  assert(!home.includes('SeasonCard'));
  assert(!('components/home/SeasonCard.tsx' in SOURCES));
});

// ── Tap through ────────────────────────────────────────────────────────────

Deno.test('This week opens Matchup: the whole card, a button with the hint, a chevron after the chip', () => {
  assertEquals(THIS_WEEK_HREF, '/(tabs)/matchup');
  assertEquals(OPENS_MATCHUP_HINT, 'Opens Matchup');
  const card = SOURCES['components/home/ThisWeekCard.tsx'];
  const press = card.indexOf('<PressableScale\n      onPress={() => router.push(THIS_WEEK_HREF)}');
  assert(press > 0, 'the card is wrapped in a PressableScale that opens Matchup');
  assert(press < card.indexOf('<Card variant="scoreboard" style={styles.card}>'), 'the press wraps the whole card');
  assert(card.indexOf('</Card>\n    </PressableScale>') > 0);
  assert(card.includes('accessibilityRole="button"') && card.includes('accessibilityHint={OPENS_MATCHUP_HINT}'));
  assert(card.indexOf('{liveChipLabel ?? LIVE_CHIP}') < card.indexOf('<Ionicons name="chevron-forward" size={16} color={colors.text2} />'));
});

Deno.test('Standings opens League on Standings: the whole card, a chevron after "Through Week N"', () => {
  assertEquals(STANDINGS_HREF, { pathname: '/(tabs)/league', params: { segment: 'standings' } });
  const card = SOURCES['components/home/StandingsCard.tsx'];
  const press = card.indexOf('<PressableScale onPress={() => router.push(STANDINGS_HREF)} accessibilityRole="button">');
  assert(press > 0 && press < card.indexOf('<Card style={styles.card}>'));
  assert(card.indexOf('{standingsThroughWeekCaption(throughWeek)}') < card.indexOf('<Ionicons name="chevron-forward"'));
});

Deno.test("League reads ?segment= (as Matchup reads 'all') and clears it, so a second tap lands too", () => {
  assertEquals(leagueSegmentFromParam('standings'), 'standings');
  assertEquals(leagueSegmentFromParam(['schedule']), 'schedule');
  assertEquals(leagueSegmentFromParam(undefined), null);
  assertEquals(leagueSegmentFromParam('nope'), null);
  const league = SOURCES['app/(tabs)/league.tsx'];
  assert(league.includes('const { segment: segmentParam } = useLocalSearchParams<{ segment?: string }>();'));
  assert(league.includes('const s = leagueSegmentFromParam(segmentParam);'));
  assert(league.includes('setSegment(s);\n    router.setParams({ segment: undefined });'));
  assert(league.includes('}, [segmentParam]);'));
});

// ── The live chip ──────────────────────────────────────────────────────────

Deno.test('the live chip reads "Live", playoff or not (the week is in the hero meta)', () => {
  assertEquals(LIVE_CHIP, 'Live');
  assert(home.includes('liveChipLabel: LIVE_CHIP, tag };'));
  assert(!home.includes('· Live`'));
  assert(!SOURCES['lib/home/homeCopy.ts'].includes('PLAYOFF_LIVE_CHIP'));
});

// ── Season over: one primary ───────────────────────────────────────────────

Deno.test('season over: Run it back (commissioner) or the ask (member) is the only primary; none with the switch off', () => {
  assertEquals(seasonOverPrimary({ runItBackOn: true, isCommissioner: true, hasSuccessor: false }), 'run_it_back');
  assertEquals(seasonOverPrimary({ runItBackOn: true, isCommissioner: true, hasSuccessor: true }), 'run_it_back');
  assertEquals(seasonOverPrimary({ runItBackOn: true, isCommissioner: false, hasSuccessor: true }), 'renewal_ask');
  assertEquals(seasonOverPrimary({ runItBackOn: true, isCommissioner: false, hasSuccessor: false }), null);
  assertEquals(seasonOverPrimary({ runItBackOn: false, isCommissioner: true, hasSuccessor: true }), null);
  assert(home.includes("{primary === 'run_it_back' ? <RunItBackCard /> : null}"));
  assert(home.includes("{primary === 'renewal_ask' && league?.successor_league_id ? ("));
});

Deno.test('the season-over card has no filled button: "See the final standings" is a row with a chevron, inside the one card', () => {
  const card = SOURCES['components/home/SeasonCompleteCard.tsx'];
  assert(!code(card).includes('<Button'), 'no Button in the season-over card');
  assert(card.includes("<ListRow title={SEE_FINAL_STANDINGS} onPress={() => router.push('/(tabs)/league')} divider={false} />"));
  // One card: the medallion block, a hairline, the tiles, a hairline, the row.
  assertEquals((code(card).match(/<Card\b/g) ?? []).length, 1);
  const order = ['<View style={styles.medallionBlock}>', '<View style={[styles.hairline', '<View style={styles.tilesGrid}>', '<View style={[styles.hairline', '<ListRow'];
  let at = 0;
  for (const piece of order) {
    const i = card.indexOf(piece, at);
    assert(i >= at, `out of order: ${piece}`);
    at = i + 1;
  }
  // The disc is 60pt; the champion's wash fades out by the middle.
  assert(card.includes('discPt={60}'));
  assert(card.includes("locations={[0, 0.5]}"));
});

// ── Before the draft ───────────────────────────────────────────────────────

const F = (o: Partial<PreDraftFlags>): PreDraftFlags => ({
  memberPostponed: false, noDate: false, date: false, roomOpenTag: false, countdown: false, starting: false,
  pick: false, pickClock: false, orderSet: false, waiting: false, buttons: false, ...o,
});

Deno.test('with a draft time the countdown leads: countdown, date, pick clock, order line, button, then no-buying', () => {
  assertEquals(
    preDraftBlocks(F({ countdown: true, date: true, pickClock: true, orderSet: true, buttons: true })),
    ['countdown', 'date', 'pickClock', 'orderSet', 'buttons', 'noBuying'],
  );
  // Room open: its tag heads the countdown, your position follows.
  assertEquals(
    preDraftBlocks(F({ roomOpenTag: true, countdown: true, date: true, pick: true, pickClock: true, buttons: true })),
    ['roomOpenTag', 'countdown', 'date', 'pick', 'pickClock', 'buttons', 'noBuying'],
  );
});

Deno.test('the no-buying line sits directly under the button and is hidden while waiting for managers', () => {
  const waiting = preDraftBlocks(F({ date: true, pickClock: true, waiting: true }));
  assert(!waiting.includes('noBuying') && !waiting.includes('buttons'));
  const noDate = preDraftBlocks(F({ noDate: true, pickClock: true, buttons: true }));
  assertEquals(noDate, ['noDate', 'pickClock', 'buttons', 'noBuying']);
  const postponed = preDraftBlocks(F({ memberPostponed: true, buttons: true }));
  assertEquals(postponed, ['postponedTitle', 'postponedLine', 'buttons', 'noBuying']);
  // No separate note card any more: the line is a centred caption inside the draft card.
  const card = SOURCES['components/home/PreDraftCard.tsx'];
  assertEquals(card.split('{NO_BUYING_BEFORE_DRAFT}').length, 2);
  assert(card.includes('<Text variant="caption" tone="secondary" style={styles.noBuying}>'));
  assert(/noBuying:\s*\{\s*textAlign: 'center',/.test(card));
  assert(card.includes('buttons: !waiting,'));
});

Deno.test('the "Pre-draft" chip is gone; "Postponed" stays; the order line has no dot', () => {
  assertEquals(preDraftChipShown(true), true);
  assertEquals(preDraftChipShown(false), false);
  const card = SOURCES['components/home/PreDraftCard.tsx'];
  assert(card.includes('{preDraftChipShown(postponed) ? ('));
  assert(!card.includes('PRE_DRAFT_CHIP') && !SOURCES['lib/home/homeCopy.ts'].includes('PRE_DRAFT_CHIP'));
  assert(card.includes("case 'orderSet':\n        return <Text variant=\"callout\" tone=\"secondary\">{orderSetLine(finalizeAt!)}</Text>;"));
  assert(!card.includes('styles.dot'));
  // The card renders in preDraftBlocks' order.
  assert(card.includes('{blocks.map((b) => <View key={b}>{renderBlock(b)}</View>)}'));
});
