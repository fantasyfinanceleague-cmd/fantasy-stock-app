/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
/**
 * PortfolioScreen: the Portfolio tab (3e; W4, Game Night). Renders usePortfolioData's view
 * and nothing else: every figure comes from portfolioView, the line from portfolioChart.
 *
 * Game Night (§9C, the board's Portfolio frame, A): the money page (`moneyBg`); the hero is
 * "Portfolio value" over the value in `money` (44/500, rule 5: money numbers regular), the
 * gain since the draft and today; then the value line edge to edge on its dated axis, with
 * the range pills (1W · 1M · Season; Giorgio, 2026-10-12: "the Portfolio chart with range
 * pills: yes"). Then the cash, "Buy a stock", the holdings as roster rows (no sparklines,
 * no rules between them), Trade history and the Alpaca credit. 24pt between blocks.
 *
 * Tapping a holding opens its PLAYER CARD (deferred from the Matchup gate), exactly as on
 * Matchup; the card's Sell closes it and opens the stock sheet on Sell. A row whose card
 * can't be whole (no opening event in the ledger, or the week's data didn't load) opens the
 * stock sheet instead, so no row is ever a dead tap.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { radius, space } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import type { ThemeColors } from '@/constants/tokens/color';
import { Card } from '@/components/sp/Card';
import { Icon } from '@/components/sp/Icon';
import { Chart, PlayerCard, RangePills, type PlayerCardOwnership } from '@/components/sp/gn';
import { formatMoney } from '@/components/sp/logic/money';
import { ShellHeader } from '@/components/shell/ShellHeader';
import { useStockSheet } from '@/components/money/MoneyHost';
import { LoadFailure } from '@/components/money/LoadFailure';
import { HoldingRow, ROW_TEXT_MAX_SCALE } from '@/components/money/HoldingRow';
import { PortfolioSkeleton } from '@/components/money/PortfolioSkeleton';
import { RollingMoney } from '@/components/home/RollingMoney';
import { COPY } from '@/lib/money/moneyCopy';
import { usePortfolioData } from '@/lib/money/usePortfolioData';
import { usePortfolioLedger } from '@/lib/money/usePortfolioLedger';
import { dailyValues, DEFAULT_PORTFOLIO_RANGE, mondayOf, PORTFOLIO_RANGES, portfolioSeries, type PortfolioRange } from '@/lib/money/portfolioChart';
import { MONEY_FIXTURE } from '@/lib/money/devFixture';
import { FIXTURE_LEAGUE_ID } from '@/lib/money/fixtureMode';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useSession } from '@/lib/SessionProvider';
import { useHomeLeague } from '@/lib/home/useHomeLeague';
import { toLiveSnapshots, toLiveTrades } from '@/lib/home/buildHomeViewModel';
import { useRosterData } from '@/lib/game/useRosterData';
import { cardSlotPill, etDateOf, weekSessions } from '@/lib/game/matchupRoster';
import { playerCardData, stockWeek } from '@/lib/game/playerCardModel';
import { SEAM_ON } from '@/lib/game/devSeam';
import { decideTradeGate } from '@/lib/money/tradeGate';
import { marketOpensLabel } from '@/lib/money/marketOpensLabel';
import { resolveWeekWindow, standardWeekSessions } from '@/lib/time/marketWeek';
import { useCaptureAction } from '@/lib/money/captureScript';
import { preDraftPortfolio } from '@/lib/money/preDraftPortfolio';
import { Button } from '@/components/sp/Button';
import { keepMoney } from '@/lib/game/keepDots';

/** gain/loss/zero -> its theme colour (C-6: the same mapping Home's hero uses). */
function toneColor(colors: ThemeColors, tone: 'gain' | 'loss' | 'zero' | null): string {
  if (tone === 'gain') return colors.gain;
  if (tone === 'loss') return colors.loss;
  return colors.zero;
}

/** Capture seam only: the fixture path, then Home's bars after its last day. */
function seamCardBars(path: readonly { date: string; close: number }[], home: readonly { date: string; close: number }[]) {
  const last = path.length ? path[path.length - 1].date : '';
  return [...path, ...home.filter((b) => b.date > last)];
}

/** The value line's plot height (the board's amended Portfolio frame: 168). */
const CHART_HEIGHT = 168;
/** The hero's label, caption and sub-lines follow Dynamic Type to 1.3×, so the value stays the
 * standout (at XXXL an uncapped "+$3,518,517.00" rivalled the fitted value). */
const HERO_LINE_MAX_SCALE = 1.3;

export function PortfolioScreen() {
  const { colors } = useTheme();
  const data = usePortfolioData();
  const stockSheet = useStockSheet();
  const router = useRouter();
  const { user } = useSession();
  const { activeLeague, activeLeagueId, market, setActiveLeagueId } = useLeagueContext();
  const leagueId = activeLeague?.id ?? (MONEY_FIXTURE ? FIXTURE_LEAGUE_ID : null);
  const ledgerState = usePortfolioLedger(leagueId);
  // The player card's week (Matchup's own read: the week's snapshots, trades and bars) and
  // its slot pill (the league's slots).
  const home = useHomeLeague(MONEY_FIXTURE ? null : activeLeagueId);
  const roster = useRosterData(MONEY_FIXTURE ? null : activeLeagueId, user?.id ?? null, null);
  const [range, setRange] = useState<PortfolioRange>(DEFAULT_PORTFOLIO_RANGE);
  const [selected, setSelected] = useState<string | null>(null);
  // The card stays mounted while it leaves, with the stock it was showing.
  const [shown, setShown] = useState<string | null>(null);
  const pendingSell = useRef<{ symbol: string; name: string } | null>(null);

  // The capture seam plays the Home fixture's clock and market; production reads now.
  const raw = home.raw;
  const now = SEAM_ON && raw ? raw.now : new Date();
  const todayEt = etDateOf(now) ?? now.toISOString().slice(0, 10);
  const phase = home.viewModel?.phase ?? null;
  const gate = decideTradeGate(new Date(), market);
  const marketOpen = SEAM_ON ? phase?.kind === 'live_open' : gate.open;
  const opens = marketOpensLabel(SEAM_ON ? (phase?.kind === 'live_closed' ? phase.resumesAt : null) : market?.next_open_at ?? null);

  // This week's sessions (the 1W axis and the card's week line).
  const calendar = raw?.marketCalendar ?? [];
  const sessions = useMemo(() => {
    const win = resolveWeekWindow(now.toISOString(), calendar);
    const fromCalendar = win ? weekSessions(win.weekStart, win.weekEnd, calendar) : [];
    return fromCalendar.length ? fromCalendar : standardWeekSessions(`${mondayOf(todayEt)}T16:00:00Z`);
    // `now` moves every render; the week only changes with the date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar, todayEt]);

  const chart = data.chart;
  const daily = useMemo(() => (chart ? dailyValues({ rows: chart.rows, bars: chart.bars, stake: chart.stake, todayEt }) : []), [chart, todayEt]);
  const series = useMemo(
    () => (chart ? portfolioSeries({ range, daily, liveValue: chart.liveValue, todayEt, now, sessions, draftAt: chart.draftAt }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chart, range, daily, todayEt, sessions],
  );

  // The card's data for the stock it's showing (null: no opening event, or no week read).
  const card = useMemo(() => {
    if (!shown || !ledgerState.ledger || !user || !raw) return null;
    const me = user.id;
    const price = data.prices[shown] ?? raw.quote(shown);
    if (price == null) return null;
    const snapshots = toLiveSnapshots(raw.data.current_week.my_snapshots);
    const trades = toLiveTrades(raw.data.current_week.my_trades);
    const cardData = playerCardData({
      symbol: shown,
      company: ledgerState.ledger.symbol_names[shown] ?? '',
      userId: me,
      activity: ledgerState.ledger.activity,
      snapshots,
      trades,
      weekGain: stockWeek(shown, snapshots, trades, price).gain,
      price,
      // The capture seam: the fixture's own daily path through Wednesday, then Home's bars
      // after it (as Matchup's card reads it), so the week moves every day.
      bars: SEAM_ON ? seamCardBars(chart?.bars[shown] ?? [], raw.bars[shown] ?? []) : raw.bars[shown] ?? chart?.bars[shown] ?? [],
      seasonBars: chart?.bars[shown] ?? null,
      sessions,
      now,
    });
    if (!cardData) return null;
    const slotId = roster.slots.bySide[me]?.[shown] ?? null;
    const pill = cardSlotPill(roster.slots.slots.find((s) => s.id === slotId) ?? null);
    return { data: cardData, pill };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, ledgerState.ledger, user, raw, data.prices, chart, sessions, roster.slots]);

  function pillFor(symbol: string) {
    if (!user) return null;
    const slotId = roster.slots.bySide[user.id]?.[symbol] ?? null;
    return cardSlotPill(roster.slots.slots.find((s) => s.id === slotId) ?? null);
  }

  // A row opens its player card when the card can be whole; otherwise the stock sheet (never
  // a dead tap). The card needs the ledger's opening event and the week's read.
  function openRow(symbol: string, name: string) {
    if (ledgerState.ledger && raw && user) {
      setSelected(symbol);
      setShown(symbol);
      return;
    }
    stockSheet.open(symbol, { name, originRef: symbol });
  }

  // DEV capture only (captureScript): the same handlers a tap runs.
  const scrollRef = useRef<ScrollView>(null);
  useCaptureAction('range', (r) => { if (r === '1W' || r === '1M' || r === 'Season') setRange(r); });
  useCaptureAction('card', (sym) => { if (sym) openRow(sym, ledgerState.ledger?.symbol_names[sym] ?? sym); });
  useCaptureAction('sell', () => {
    if (!card || card.data.held <= 0) return;
    pendingSell.current = { symbol: card.data.ticker, name: card.data.company };
    setSelected(null);
  });
  useCaptureAction('close', () => setSelected(null));
  useCaptureAction('sheet', (sym) => { if (sym) stockSheet.open(sym, { name: ledgerState.ledger?.symbol_names[sym] ?? null }); });
  useCaptureAction('search', () => router.push('/stock-search'));
  useCaptureAction('league', (id) => { if (id) setActiveLeagueId(id); });
  useCaptureAction('scroll', (y) => scrollRef.current?.scrollTo({ y: Number(y) || 0, animated: false }));

  let body: React.ReactNode;
  const preDraft = activeLeague ? preDraftPortfolio(activeLeague.draft_status, activeLeague.draft_date) : null;
  if (preDraft) {
    // Before the draft is done: the app's line, and Home's own hook (W4 DL gate: never a dead
    // end) — the draft room during the draft, the draft's date and time before it.
    body = (
      <View style={styles.empty} accessible={preDraft.hook?.kind !== 'room'} accessibilityLabel={[preDraft.line, preDraft.hook?.label].filter(Boolean).join(' ')}>
        <View style={[styles.emptyDisc, { backgroundColor: colors.inset }]}>
          <Icon name="lock" size="title" tone="text2" />
        </View>
        <Text variant="headline" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE} style={[styles.extraBold, styles.center]}>{preDraft.line}</Text>
        {preDraft.hook?.kind === 'date' ? (
          <Text variant="callout" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE} style={[styles.bold, styles.center]} testID="portfolio-pre-draft-date">{preDraft.hook.label}</Text>
        ) : null}
        {preDraft.hook?.kind === 'room' ? (
          <View style={styles.emptyAction}>
            <Button label={preDraft.hook.label} variant="primary" fullWidth onPress={() => router.push('/(tabs)/league')} testID="portfolio-go-to-draft-room" />
          </View>
        ) : null}
      </View>
    );
  } else if (data.status === 'loading') {
    body = <PortfolioSkeleton />;
  } else if (data.status === 'error' || !data.view) {
    body = <LoadFailure title={COPY.portfolioLoadTitle} message={COPY.loadRetryMessage} onRetry={data.refresh} />;
  } else {
    const v = data.view;
    const rollKey = activeLeague?.id ?? '';
    body = (
      <View style={styles.blocks}>
        {/* The hero: the value, the gain since the draft, today; then the line and its range. */}
        <View style={styles.hero}>
          <View style={styles.heroText}>
            <Text variant="caption" tone="secondary" maxFontSizeMultiplier={HERO_LINE_MAX_SCALE}>{v.valueLabel}</Text>
            {/* M3: every money figure that changes on a quote refresh rolls. One accessible
                element each: RollingMoney renders one Text per character. */}
            <View accessible accessibilityRole="header" accessibilityLabel={`${v.valueLabel}, ${v.valueText}`}>
              <RollingMoney text={v.valueText} size="money" rollKey={rollKey} />
            </View>
            {v.gainMoneyText && v.gainPctText ? (
              <HeroLine
                label={`${v.gainText} ${v.sinceDraftLabel}`}
                money={v.gainMoneyText}
                pct={v.gainPctText}
                words={v.sinceDraftLabel}
                color={toneColor(colors, v.gainTone)}
                rollKey={rollKey}
              />
            ) : null}
            {v.todayMoneyText && v.todayPctText ? (
              <HeroLine
                label={`${v.todayText} today`}
                money={v.todayMoneyText}
                pct={v.todayPctText}
                words="today"
                color={toneColor(colors, v.todayTone)}
                rollKey={rollKey}
              />
            ) : null}
            {v.unpricedNote ? <Text variant="caption" tone="secondary" maxFontSizeMultiplier={HERO_LINE_MAX_SCALE}>{v.unpricedNote}</Text> : null}
          </View>
          {series ? (
            <Chart
              points={series.points}
              base={series.base}
              axis={series.axis}
              height={CHART_HEIGHT}
              bleed={space[6]}
              live={marketOpen}
              drawKey={range}
              formatValue={(n) => formatMoney(n)}
              accessibilityLabel="Portfolio value"
              captureScrubAction="scrub"
            />
          ) : null}
          {/* Measured from pixels (W4 capture): the pills' own 6pt target margins put them 21pt under
              the dates and the next block 34pt below; pulled in so the pills sit ~12pt under the
              dates and the 24pt block gap is measured from the pill, glyph to glyph. Each pill
              keeps its 44pt target (32pt fill + its hit slop). */}
          <View style={styles.pillsRow}>
            <RangePills options={PORTFOLIO_RANGES} value={range} onChange={setRange} variant="pills" />
          </View>
        </View>

        {/* Cash and slots: what the team has to invest. */}
        {v.cashValueText || v.slotsText ? (
          <View style={styles.facts}>
            {v.cashValueText ? (
              <View style={styles.factRow} accessible accessibilityLabel={`${COPY.cashFromSales}, ${v.cashValueText}`}>
                <Text variant="callout" tone="secondary" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE}>{COPY.cashFromSales}</Text>
                <Text variant="score.sm" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE} style={styles.bold}>{keepMoney(v.cashValueText)}</Text>
              </View>
            ) : null}
            {v.slotsText ? (
              <View style={styles.factRow}>
                <Text variant="callout" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE} style={styles.bold}>{v.slotsText}</Text>
                {v.perSlotText ? <Text variant="caption" tone="secondary" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE}>{keepMoney(v.perSlotText)}</Text> : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Buy a stock: the entry to search (board #buy-a-stock), saying what can be spent. */}
        <Card>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={v.buyRowText ? `${COPY.buyAStock}, ${v.buyRowText}` : COPY.buyAStock}
            onPress={() => router.push('/stock-search')}
            style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.7 : 1 }]}
            testID="portfolio-buy-a-stock"
          >
            <View style={[styles.linkTile, { backgroundColor: colors.accentTint }]}>
              <Icon name="search" size="body" tone="accent" />
            </View>
            <View style={styles.linkText}>
              <Text variant="callout" color={colors.accent} maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE} style={styles.extraBold}>{COPY.buyAStock}</Text>
              {v.buyRowText ? <Text variant="caption" tone="secondary" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE}>{keepMoney(v.buyRowText)}</Text> : null}
            </View>
            <Icon name="chevronRight" size="callout" tone="text2" />
          </Pressable>
        </Card>

        {/* Holdings: roster rows, no sparklines; each opens its player card. */}
        <View>
          <View style={styles.listHead}>
            <Text variant="headline" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE} style={styles.extraBold}>{COPY.holdingsHeading}</Text>
            {v.rows.length ? <Text variant="caption" tone="secondary" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE}>Value · today</Text> : null}
          </View>
          {v.rows.map((r) => (
            <HoldingRow key={r.symbol} row={r} pill={pillFor(r.symbol)} onPress={() => openRow(r.symbol, r.name)} />
          ))}
        </View>

        <Card>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${COPY.tradeHistory}, ${COPY.includesDraftPicks}`}
            onPress={() => router.push('/trade-history')}
            style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.7 : 1 }]}
            testID="portfolio-trade-history"
          >
            <View style={styles.linkText}>
              <Text variant="callout" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE} style={styles.bold}>{COPY.tradeHistory}</Text>
              <Text variant="caption" tone="secondary" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE}>{COPY.includesDraftPicks}</Text>
            </View>
            <Icon name="chevronRight" size="callout" tone="text2" />
          </Pressable>
        </Card>

        <Text variant="caption" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE} tone="secondary" style={styles.center}>{v.creditText}</Text>
      </View>
    );
  }

  let ownership: PlayerCardOwnership | null = null;
  if (card) {
    ownership = card.data.held > 0
      ? {
        owner: 'you',
        onSell: () => {
          // The stock sheet (Sell selected for a held stock) opens once the card has left.
          pendingSell.current = { symbol: card.data.ticker, name: card.data.company };
          setSelected(null);
        },
      }
      : { owner: 'you', sold: true };
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.moneyBg }]}>
      <ShellHeader title="Portfolio" showPhase />
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>{body}</ScrollView>
      {card && ownership ? (
        <PlayerCard
          {...card.data}
          {...ownership}
          {...(card.pill ?? {})}
          visible={selected !== null}
          onClose={() => setSelected(null)}
          onClosed={() => {
            setShown(null);
            const sell = pendingSell.current;
            pendingSell.current = null;
            if (sell) stockSheet.open(sell.symbol, { name: sell.name });
          }}
          marketOpen={marketOpen}
          opens={opens}
        />
      ) : null}
    </View>
  );
}

/** A hero sub-line: "+$X · +Y% since the draft". The money and the percent roll as two units
 * (C-6/M3: one string misaligns mid-roll), each "·" stays glued to the figure before it, so a
 * wrapped line never starts with "·" (§5 "Wrapping at XL"), and everything caps at 1.3× so the
 * value stays the screen's loudest text at XL (§5 "The standout stays loudest"). Above 1.3× the
 * sp Text primitive (and RollingMoney) turn that cap into an explicit size (cappedType.ts): Home
 * draws the same " · " and figures uncapped in the same face, and iOS gave the capped copies those
 * uncapped boxes (P2, 2026-10-16/19). */
function HeroLine({ label, money, pct, words, color, rollKey }: { label: string; money: string; pct: string; words: string; color: string; rollKey: string }) {
  return (
    <View accessible accessibilityLabel={label} style={styles.rollRow}>
      <View style={styles.nowrap}>
        <RollingMoney text={money} size="callout" fontWeight="700" color={color} rollKey={rollKey} maxScale={HERO_LINE_MAX_SCALE} />
        <Text variant="callout" color={color} maxFontSizeMultiplier={HERO_LINE_MAX_SCALE} style={styles.bold}>{' · '}</Text>
      </View>
      <View style={styles.nowrap}>
        <RollingMoney text={pct} size="callout" fontWeight="700" color={color} rollKey={rollKey} maxScale={HERO_LINE_MAX_SCALE} />
        <Text variant="callout" tone="secondary" maxFontSizeMultiplier={HERO_LINE_MAX_SCALE}>{`\u00a0${words}`}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: space[6], paddingTop: space[2], paddingBottom: space[9] },
  // §9C: the calm screens' 24pt between blocks.
  blocks: { gap: space[7] },
  hero: { gap: space[4] },
  heroText: { gap: space[1] },
  pillsRow: { marginTop: -space[3], marginBottom: -space[3] },
  rollRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' },
  nowrap: { flexDirection: 'row', alignItems: 'baseline' },
  facts: { gap: space[3] },
  factRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', columnGap: space[3] },
  linkRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space[4], paddingHorizontal: space[5], paddingVertical: space[4] },
  linkTile: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  linkText: { flex: 1, minWidth: 0, gap: space[1] },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: space[1] },
  bold: { fontWeight: '700' },
  extraBold: { fontWeight: '800' },
  center: { textAlign: 'center' },
  empty: { alignItems: 'center', gap: space[4], paddingTop: space[10] },
  emptyDisc: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  emptyAction: { alignSelf: 'stretch', paddingTop: space[3] },
});
