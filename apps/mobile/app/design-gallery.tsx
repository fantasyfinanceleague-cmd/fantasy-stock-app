/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { ReactNode, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { radius, space } from '@/constants/tokens';
import { brand } from '@/constants/brand';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Money } from '@/components/sp/Money';
import { Button, type ButtonStatus } from '@/components/sp/Button';
import { Chip } from '@/components/sp/Chip';
import { PhaseChip, LeaguePhase } from '@/components/sp/PhaseChip';
import { ListRow } from '@/components/sp/ListRow';
import { SegmentedControl } from '@/components/sp/SegmentedControl';
import { Sheet } from '@/components/sp/Sheet';
import { Avatar } from '@/components/sp/Avatar';
import { EmptyState } from '@/components/sp/EmptyState';
import { BrandMark } from '@/components/sp/BrandMark';
import { LiveDot } from '@/components/sp/game/LiveDot';
import { Scoreboard } from '@/components/sp/game/Scoreboard';
import { useMotion } from '@/components/sp/motion';
import { useTheme, ThemePreference } from '@/components/sp/ThemeProvider';
import {
  CategoryPill, Chart, DraftTile, GroupHead, MANAGER_ROW_GAP, ManagerRow, PlayerCard, PlayerCardBody, RangePills, RosterRow,
  Scoreboard as GnScoreboard, type PlayerCardProps, type RosterHalf,
} from '@/components/sp/gn';
import { CATEGORIES, type Category } from '@/components/sp/logic/gameNight';
import { formatMoney } from '@/components/sp/logic/money';

// Stockpile — dev-only design gallery (§9A, "One design, two themes",
// 2026-09-29). SOURCE OF TRUTH: the Phase 2 brief, build item 7: "renders
// every primitive in every state... This is your proof and the living
// spec," now extended with the Light/Dark/System theme switch §9A asks for.
// Redirects home outside __DEV__ so it never ships as a reachable screen in
// a release build.
//
// The old "money surface" / "game surface" section split is gone along with
// <Surface kind>: a screen is entirely Light or entirely Dark now, so there's
// nothing left to illustrate as two separately-coloured boxes on the same
// screen — every section here just renders on one <Card>, in whichever
// theme the switch above is set to.

const ALL_PHASES: LeaguePhase[] = [
  'pre_draft',
  'drafting',
  'pre_season',
  'live_open',
  'live_closed',
  'week_final',
  'playoffs',
  'season_complete',
];

const THEME_OPTIONS: { label: string; value: ThemePreference }[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

export default function DesignGalleryScreen() {
  // Hooks run unconditionally, ABOVE the __DEV__ early return below — RN's
  // eslint-plugin-react-hooks rules-of-hooks (error-level in this repo) has
  // no special case for a compile-time-constant guard, so the guard has to
  // come after every hook call, not before.
  const { reduced } = useMotion();
  const { preference, resolvedTheme, colors, setPreference } = useTheme();
  const [segment, setSegment] = useState('all');
  const [sheetVisible, setSheetVisible] = useState(false);
  const [chipSelected, setChipSelected] = useState(false);
  const [scores, setScores] = useState({ you: 128.4, opponent: 92.1 });
  const [chyron, setChyron] = useState<string | null>(null);
  const [demoStatus, setDemoStatus] = useState<ButtonStatus>('idle');

  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  function triggerLeadChange() {
    setScores((prev) => {
      // Flip who's ahead so <TugBar>/<ScoreDigits> exercise the lead-change
      // overshoot (`spring.lively`) rather than just ticking in place.
      const wasYouAhead = prev.you >= prev.opponent;
      const next = wasYouAhead ? { you: prev.you - 40, opponent: prev.opponent + 260 } : { you: prev.you + 260, opponent: prev.opponent - 40 };
      return next;
    });
    setChyron('NVDA just put you ahead');
  }

  return (
    // Orchestrator, 2026-09-29 follow-up: this screen has no header of its
    // own (unlike the real app screens, which put a header or tab bar
    // between the status bar and their content), so its top content was
    // sitting directly under the status bar/notch — SafeAreaView fixes
    // that. Bottom is left unprotected on purpose: this is a scrolling dev
    // screen, so content running under the home indicator at the very end
    // of the scroll is normal, the same as any other scrollable screen.
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { backgroundColor: colors.bg }]}>
        <Section title="Theme">
          <SegmentedControl options={THEME_OPTIONS} value={preference} onChange={(value) => setPreference(value as ThemePreference)} />
          <Text variant="body" tone="secondary">
            {`preference = ${preference}, resolvedTheme = ${resolvedTheme}`}
          </Text>
        </Section>
  
        <GameNightGallery />

        <Section title="Reduce Motion">
          <Text variant="body">{`useMotion().reduced = ${reduced ? 'true' : 'false'}`}</Text>
        </Section>
  
        <Section title="Brand">
          <View style={styles.row}>
            <BrandMark size={32} />
            <Text variant="title">{brand.wordmark}</Text>
          </View>
        </Section>
  
        <Section title="Type">
          <Card style={styles.card}>
            <Text variant="tag">LIVE · WEEK 3</Text>
            <Text variant="score.xl">$1,234</Text>
            <Text variant="score.lg">$1,234</Text>
            <Text variant="score.md">$1,234</Text>
            <Text variant="display">Portfolio</Text>
            <Text variant="title">Screen title</Text>
            <Text variant="headline">Section head</Text>
            <Text variant="body">Running text at body size.</Text>
            <Text variant="callout" tone="secondary">
              Secondary callout line
            </Text>
            <Text variant="caption" tone="secondary">
              Smallest informational caption
            </Text>
            <Text variant="body" tone="disabled">
              Disabled text
            </Text>
          </Card>
        </Section>
  
        <Section title="Money — sign & compact">
          <Card style={styles.card}>
            <Money value={56.8} sign="always" />
            <Money value={-3000} sign="always" />
            <Money value={0} sign="always" />
            <Money value={1234567.891} compact />
            <Money value={-0.004} sign="always" />
            <Money value={128.4} colorBySign />
            <Money value={-92.1} colorBySign />
            <Money value={0} colorBySign />
          </Card>
        </Section>
  
        <Section title="Buttons">
          <Card style={styles.card}>
            <View style={styles.row}>
              <Button label="Primary" variant="primary" onPress={() => {}} />
              <Button label="Secondary" variant="secondary" onPress={() => {}} />
            </View>
            <View style={styles.row}>
              <Button label="Ghost" variant="ghost" onPress={() => {}} />
              <Button label="Destructive" variant="destructive" onPress={() => {}} />
            </View>
            <View style={styles.row}>
              <Button label="Small" variant="primary" size="sm" onPress={() => {}} />
              <Button label="Disabled" variant="primary" onPress={() => {}} disabled />
            </View>
            {/* status (Phase 3b-1): each state pinned, then a live idle → loading → done run. */}
            <View style={styles.row}>
              <Button label="Sign in" status="idle" onPress={() => {}} />
              <Button label="Sign in" status="loading" onPress={() => {}} />
              <Button label="Sign in" status="done" onPress={() => {}} />
            </View>
            <View style={styles.row}>
              <Button
                label="Run status demo"
                variant="secondary"
                status={demoStatus}
                onPress={() => {
                  setDemoStatus('loading');
                  setTimeout(() => setDemoStatus('done'), 1200);
                  setTimeout(() => setDemoStatus('idle'), 2400);
                }}
              />
            </View>
          </Card>
        </Section>
  
        <Section title="Chip & PhaseChip">
          <Card style={styles.card}>
            <View style={styles.row}>
              <Chip label="All leagues" selected={chipSelected} onPress={() => setChipSelected((v) => !v)} />
              <Chip label="Disabled" disabled />
            </View>
            <View style={[styles.row, styles.wrap]}>
              {ALL_PHASES.map((phase) => (
                <PhaseChip key={phase} phase={phase} />
              ))}
            </View>
            {/* `label` (Phase 3b-1): the phase keeps the style, the label replaces the text. */}
            <View style={[styles.row, styles.wrap]}>
              <PhaseChip phase="live_open" label="Week 6" />
              <PhaseChip phase="live_closed" label="Week 2" />
              <PhaseChip phase="pre_draft" label="Draft Sat 7:00 PM ET" />
              <PhaseChip phase="season_complete" label="Final" />
            </View>
          </Card>
        </Section>
  
        <Section title="ListRow">
          <Card style={styles.card}>
            <ListRow title="Test League" subtitle="Rank 2 · 5-1" onPress={() => {}} trailing={<Avatar name="Priya" size={28} />} />
            <ListRow title="No chevron" subtitle="hideChevron" hideChevron trailing={<Text variant="callout">3rd</Text>} />
          </Card>
        </Section>
  
        <Section title="SegmentedControl">
          <Card style={styles.card}>
            <SegmentedControl
              options={[
                { label: 'All matchups', value: 'all' },
                { label: 'Mine', value: 'mine' },
              ]}
              value={segment}
              onChange={setSegment}
            />
          </Card>
        </Section>
  
        <Section title="Avatar">
          <View style={styles.row}>
            <Avatar name="Priya" size={44} />
            <Avatar name="Giorgio" size={32} />
            <Avatar name="?" size={24} />
            {/* Two initials (Phase 3b-1): first word + last word; 28pt is the smallest in use. */}
            <Avatar name="Roberto B." size={44} />
            <Avatar name="roberto_b" size={36} />
            <Avatar name="Gianluigi Buffon" size={28} />
          </View>
        </Section>
  
        <Section title="LiveDot">
          <Card style={styles.card}>
            <View style={styles.row}>
              <LiveDot />
              <Text variant="tag">LIVE</Text>
            </View>
          </Card>
        </Section>
  
        <Section title="EmptyState">
          {/* Informational (no action): flat. */}
          <EmptyState
            icon={(p) => <Ionicons name="swap-horizontal-outline" {...p} />}
            title="No trades yet"
            message="Trades you make will show up here."
          />
          <EmptyState
            icon={(p) => <Ionicons name="trophy-outline" {...p} />}
            title="No leagues yet"
            message="Create or join a league to get started."
            actionLabel="Create a league"
            onAction={() => {}}
          />
          {/* With actions it is carded (3b-1 ruling); two actions stack full-width. */}
          <EmptyState
            icon={(p) => <Ionicons name="trophy-outline" {...p} />}
            title="No leagues yet"
            message="Create or join a league to get started."
            actionLabel="Create a league"
            onAction={() => {}}
            secondaryActionLabel="Join with a code"
            onSecondaryAction={() => {}}
          />
        </Section>
  
        <Section title="Sheet">
          <Button label="Open sheet" variant="secondary" onPress={() => setSheetVisible(true)} />
          <Sheet visible={sheetVisible} onClose={() => setSheetVisible(false)}>
            <View style={styles.sheetContent}>
              <Text variant="title">Sheet content</Text>
              <Text variant="body" tone="secondary">
                Drag down or tap the backdrop to dismiss.
              </Text>
            </View>
          </Sheet>
        </Section>
  
        <Section title="Live Scoreboard demo">
          <Scoreboard
            leagueName="Test League"
            week={3}
            you={{ name: 'You', gain: scores.you }}
            opponent={{ name: 'Priya', gain: scores.opponent }}
            live
            chyronMessage={chyron}
            onChyronDismiss={() => setChyron(null)}
          />
          <View style={styles.leadChangeButton}>
            <Button label="Trigger lead change" variant="primary" onPress={triggerLeadChange} />
          </View>
        </Section>
  
        <Section title="Scoreboard — widest pair (regression check)">
          {/* Design Lead, 2026-09-26: standard-size stress case for the
              accessibility-XL overflow fix — a wide leader and a wide,
              negative trailer, the combination most likely to squeeze the
              name column or push ScoreDigits past its card. */}
          <Scoreboard leagueName="Test League" week={3} you={{ name: 'You', gain: 1284.6 }} opponent={{ name: 'Priya', gain: -1038.25 }} live />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Game Night (§9C, W3): every rebuilt primitive, in its states. Sample data from the board
// (docs/design/screens/data.js: Stock Scudetto, week 6, Roberto B. vs Gianluigi B.). ──────

const ROSTER: [RosterHalf | null, RosterHalf | null][] = [
  [{ ticker: 'NVDA', company: 'NVIDIA', weekGain: 62.4, weekPct: 6.05 }, { ticker: 'NKE', company: 'Nike', weekGain: 21.38, weekPct: 2.14 }],
  [{ ticker: 'AAPL', company: 'Apple', weekGain: 31.07, weekPct: 3.08 }, { ticker: 'JPM', company: 'JPMorgan', weekGain: 5.84, weekPct: 0.58 }],
  [{ ticker: 'CRM', company: 'Salesforce', weekGain: 12.5, weekPct: 1.25 }, { ticker: 'DIS', company: 'Disney', weekGain: 15.85, weekPct: 1.58 }],
  [{ ticker: 'TSLA', company: 'Tesla', weekGain: -14.03, weekPct: -1.41 }, { ticker: 'AMZN', company: 'Amazon', weekGain: -7.14, weekPct: -0.71 }],
  [{ ticker: 'COST', company: 'Costco', weekGain: 0, weekPct: 0 }, null],
];
const STANDINGS = [
  { rank: 1, delta: 1, name: 'Gianluigi B.', record: '5–1', seasonGain: 512.4 },
  { rank: 2, delta: -1, name: 'Roberto B.', record: '4–2', seasonGain: 343.59, isYou: true },
  { rank: 3, delta: 0, name: 'Paolo M.', record: '3–3', seasonGain: 101.2 },
  { rank: 4, delta: 2, name: 'Andrea P.', record: '3–3', seasonGain: 0 },
  { rank: 5, delta: -1, name: 'Fabio C.', record: '2–4', seasonGain: -88.75 },
  { rank: 6, delta: -1, name: 'Marco R.', record: '1–5', seasonGain: -240.1 },
];
const BOARD: [string, Category][] = [
  ['MSFT', 'tech'], ['NVDA', 'tech'], ['META', 'media'], ['UNH', 'health'], ['AMZN', 'retail'], ['XOM', 'energy'],
  ['JPM', 'finance'], ['TSLA', 'transport'], ['NKE', 'retail'], ['KO', 'food'], ['CAT', 'industrials'],
];
// Your week's gain, Mon open → Thu now: closes Mon–Wed, then today (a steady build, no last-minute pop).
const WEEK_THU = [{ t: 0, value: 0 }, { t: 1, value: 96.4 }, { t: 2, value: 151.2 }, { t: 3, value: 228.3 }, { t: 3.6, value: 343.59 }];
// NVDA from the draft (Sep 29) to Thursday (Oct 8), in days since the draft.
const SEASON = [[0, 290.1], [1, 292.4], [2, 296.8], [3, 288.9], [4, 295.6], [6, 299.1], [8, 306.68], [9, 318.37]].map(([t, value]) => ({ t, value }));
const SEASON_AXIS = { kind: 'dated' as const, start: '2026-09-29', end: '2026-10-08' };
const ranges = ['Season', '1M', '1W'] as const;
const stockRanges = ['1W', '1M', '3M', '1Y'] as const;

const CARD_YOURS: PlayerCardProps = {
  visible: true, onClose: () => {}, ticker: 'NVDA', company: 'NVIDIA', owner: 'you', price: 318.37, todayPct: 3.81,
  // 3.434 sh: week (318.37 − 300.20) × qty = +$62.40; since the draft (318.37 − 290.10) × qty = +$97.09.
  weekGain: 62.4, weekPct: 6.05, sinceGain: 97.09, sincePct: 9.74, acquisition: { kind: 'drafted', pick: 2, date: 'Sep 29', price: 290.1 },
  season: { points: SEASON, base: 290.1, axis: SEASON_AXIS },
  // Mon open, the Mon–Wed closes (Wed = Oct 7's 306.68), Thu now (+3.81% today).
  week: { points: [{ t: 0, value: 300.2 }, { t: 1, value: 302.9 }, { t: 2, value: 304.1 }, { t: 3, value: 306.68 }, { t: 3.6, value: 318.37 }], base: 300.2 },
  marketOpen: false, opens: 'Mon 9:30 ET',
};
const CARD_THEIRS: PlayerCardProps = {
  // Claimed Mon Oct 5 at the open ($79.60), 12.58 sh: since the claim = this week = +$21.38 (+2.14%);
  // today from Wednesday's $80.40 close, +1.12%. The price, the lines and the figures all rise.
  ...CARD_YOURS, ticker: 'NKE', company: 'Nike', owner: { name: 'Gianluigi B.' }, category: 'retail', price: 81.3, todayPct: 1.12,
  weekGain: 21.38, weekPct: 2.14, sinceGain: 21.38, sincePct: 2.14, acquisition: { kind: 'claimed', date: 'Oct 5', price: 79.6 },
  season: { points: [{ t: 0, value: 79.6 }, { t: 1, value: 79.71 }, { t: 2, value: 80.4 }, { t: 3, value: 81.3 }], base: 79.6, axis: { kind: 'dated', start: '2026-10-05', end: '2026-10-08' } },
  week: { points: [{ t: 0, value: 79.6 }, { t: 1, value: 79.71 }, { t: 2, value: 79.95 }, { t: 3, value: 80.4 }, { t: 3.6, value: 81.3 }], base: 79.6 },
  marketOpen: true,
};

function GameNightGallery() {
  const { colors } = useTheme();
  const [range, setRange] = useState<(typeof ranges)[number]>('Season');
  const [stockRange, setStockRange] = useState<(typeof stockRanges)[number]>('1W');
  const [saved, setSaved] = useState(false);
  const [card, setCard] = useState<'yours' | 'theirs' | null>(null);
  const money = (v: number) => formatMoney(v, { sign: 'always' });

  return (
    <>
      <Section title="GN · Type (§9C)">
        <Card style={styles.card}>
          <Text variant="hero">$12,343.59</Text>
          <Text variant="money">$12,343.59</Text>
          <Text variant="score.xl">+$343.59</Text>
          <Text variant="score.lg">+$343.59</Text>
          <Text variant="score.md">+$62.40</Text>
          <Text variant="score.sm">+$512.40</Text>
          <Text variant="ticker.card">NVDA</Text>
          <Text variant="ticker">NVDA</Text>
          <Text variant="ticker.tile">NVDA</Text>
          <Text variant="tag">Tech ×3</Text>
        </Card>
      </Section>

      <Section title="GN · Card + Chip + Avatar">
        <Card style={styles.card}>
          <Text variant="headline">Card: surface + 1pt rim, no shadow</Text>
          <View style={[styles.row, styles.wrap]}>
            <PhaseChip phase="live_open" label="Live" />
            <PhaseChip phase="week_final" label="Final" />
            <PhaseChip phase="pre_draft" />
          </View>
          <View style={[styles.row, styles.wrap]}>
            <Avatar name="Roberto B." size={44} ring />
            <Avatar name="Gianluigi B." size={44} tone="opp" />
            <Avatar name="Paolo M." size={32} tone="neutral" />
          </View>
        </Card>
        <View style={[styles.row, styles.wrap]}>
          <PhaseChip phase="live_open" label="Live" onPageBackground />
          <PhaseChip phase="week_final" label="Final" onPageBackground />
        </View>
      </Section>

      <Section title="GN · Scoreboard">
        <GnScoreboard you={{ name: 'Roberto B.', gain: 343.59 }} opponent={{ name: 'Gianluigi B.', gain: 121.26 }} />
        <GnScoreboard you={{ name: 'Roberto B.', gain: -48.2 }} opponent={{ name: 'Gianluigi B.', gain: 210.05 }} final />
        <GnScoreboard you={{ name: 'Roberto B.', gain: 0 }} opponent={{ name: 'Gianluigi B.', gain: 0 }} />
      </Section>

      <Section title="GN · RosterRow: your side shaded (unslotted) + GroupHead (slotted)">
        <View style={{ gap: 6 }}>
          {ROSTER.map(([a, b], i) => (
            <RosterRow key={i} left={a} right={b} />
          ))}
        </View>
        <View style={{ gap: 6 }}>
          <GroupHead label="Tech ×2" />
          <RosterRow left={ROSTER[0][0]} right={ROSTER[2][1]} />
          <RosterRow left={ROSTER[1][0]} right={ROSTER[1][1]} />
          <GroupHead label="Flex" />
          <RosterRow left={ROSTER[3][0]} right={ROSTER[3][1]} />
        </View>
      </Section>

      <Section title="GN · CategoryPill (the 11 categories)">
        <View style={[styles.row, styles.wrap]}>
          {(Object.keys(CATEGORIES) as Category[]).map((k) => <CategoryPill key={k} category={k} />)}
        </View>
      </Section>

      <Section title="GN · DraftTile (category line + code, on the clock, empty)">
        {[0, 1, 2].map((row) => (
          <View key={row} style={styles.boardRow}>
            {[0, 1, 2, 3, 4, 5].map((col) => {
              const pick = row * 6 + col + 1;
              const tile =
                pick === 11 ? <DraftTile pick={pick} state="onClock" clock="0:42" />
                  : pick > 11 ? <DraftTile pick={pick} state="empty" />
                    : <DraftTile pick={pick} state="picked" ticker={BOARD[pick - 1][0]} category={BOARD[pick - 1][1]} />;
              return <View key={col} style={styles.boardCell}>{tile}</View>;
            })}
          </View>
        ))}
      </Section>

      <Section title="GN · ManagerRow (Standings)">
        <View style={{ gap: MANAGER_ROW_GAP }}>
          {STANDINGS.map((r) => <ManagerRow key={r.rank} {...r} />)}
        </View>
      </Section>

      <Section title="GN · RangePills">
        <RangePills variant="tabs" options={ranges} value={range} onChange={setRange} />
        <View style={[styles.moneyStrip, { backgroundColor: colors.moneyBg }]}>
          <RangePills variant="pills" options={stockRanges} value={stockRange} onChange={setStockRange} />
        </View>
      </Section>

      <Section title="GN · Chart (X axis; a line stops at now)">
        <Text variant="caption" tone="secondary">Week, Thursday, live</Text>
        <Chart points={WEEK_THU} base={0} axis={{ kind: 'week' }} bleed={space[6]} live drawKey="g-week" formatValue={money} accessibilityLabel="This week" />
        <Text variant="caption" tone="secondary">Season to now (dated), market closed</Text>
        <Chart points={CARD_YOURS.season.points} base={290.1} axis={SEASON_AXIS} bleed={space[6]} drawKey="g-season" formatValue={(v) => formatMoney(v)} accessibilityLabel="NVDA this season" />
        <Text variant="caption" tone="secondary">Home: the W/L marks, then the two end dates (start, today) under them</Text>
        <Chart points={[{ t: 0, value: 0 }, { t: 7, value: 120 }, { t: 14, value: 80 }, { t: 21, value: 210 }, { t: 28, value: 300 }, { t: 35, value: 280 }, { t: 37, value: 343.59 }]} base={0} axis={{ kind: 'dated', start: '2026-09-01', end: '2026-10-08', maxLabels: 2 }} bleed={space[6]} drawKey="g-home" formatValue={money} accessibilityLabel="Season gain"
          underPlacement="beforeAxis"
          under={<View style={styles.marks}>{['W', 'W', 'L', 'W', 'L', 'W'].map((r, i) => <Text key={i} variant="callout" color={r === 'W' ? colors.gain : colors.loss} style={styles.mark}>{r}</Text>)}</View>} />
        <Text variant="caption" tone="secondary">Down window (loss)</Text>
        <Chart points={[{ t: 0, value: 0 }, { t: 1, value: -12 }, { t: 2, value: -48.2 }]} base={0} axis={{ kind: 'week' }} bleed={space[6]} height={80} drawKey="g-loss" formatValue={money} accessibilityLabel="This week" />
        <Text variant="caption" tone="secondary">1Y, months</Text>
        <Chart points={[{ t: 0, value: 100 }, { t: 120, value: 130 }, { t: 250, value: 118 }, { t: 365, value: 160 }]} base={100} axis={{ kind: 'dated', start: '2025-10-08', end: '2026-10-08', months: true }} bleed={space[6]} height={80} drawKey="g-1y" formatValue={(v) => formatMoney(v)} accessibilityLabel="1Y" />
        <Text variant="caption" tone="secondary">Monday morning: one point</Text>
        <Chart points={[{ t: 0, value: 0 }]} base={0} axis={{ kind: 'week' }} bleed={space[6]} height={60} drawKey="g-one" formatValue={money} accessibilityLabel="This week" />
        <Text variant="caption" tone="secondary">No points yet</Text>
        <Chart points={[]} base={0} axis={{ kind: 'week' }} bleed={space[6]} height={60} drawKey="g-none" formatValue={money} accessibilityLabel="This week" />
      </Section>

      <Section title="GN · PlayerCard (yours, market closed)">
        <View style={[styles.cardHost, { backgroundColor: colors.surface }]}>
          <PlayerCardBody {...CARD_YOURS} />
        </View>
      </Section>
      <Section title="GN · PlayerCard (theirs, slotted, open)">
        <View style={[styles.cardHost, { backgroundColor: colors.surface }]}>
          <PlayerCardBody {...CARD_THEIRS} saved={saved} onToggleSave={() => setSaved((v) => !v)} />
        </View>
        <View style={styles.row}>
          <Button label="Open yours" variant="secondary" onPress={() => setCard('yours')} />
          <Button label="Open theirs" variant="secondary" onPress={() => setCard('theirs')} />
        </View>
        <PlayerCard {...(card === 'theirs' ? CARD_THEIRS : CARD_YOURS)} visible={card !== null} onClose={() => setCard(null)} saved={saved} onToggleSave={() => setSaved((v) => !v)} />
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="callout" tone="secondary" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    padding: space[6],
    gap: space[8],
  },
  section: {
    gap: space[3],
  },
  sectionTitle: {
    letterSpacing: 0.5,
  },
  sectionBody: {
    gap: space[4],
  },
  card: {
    padding: space[5],
    borderRadius: radius.lg,
    gap: space[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
  },
  wrap: {
    flexWrap: 'wrap',
  },
  sheetContent: {
    padding: space[6],
    gap: space[3],
  },
  boardRow: {
    flexDirection: 'row',
    gap: 4,
  },
  boardCell: {
    flex: 1,
    minWidth: 0,
  },
  marks: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  mark: {
    fontWeight: '800',
  },
  moneyStrip: {
    borderRadius: radius.lg,
    paddingHorizontal: space[4],
  },
  cardHost: {
    marginHorizontal: -space[6],
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: space[5],
  },
  leadChangeButton: {
    marginTop: space[4],
    alignItems: 'flex-start',
  },
});
