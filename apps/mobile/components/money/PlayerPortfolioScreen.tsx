/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
/**
 * PlayerPortfolioScreen: a leaguemate's team (3e; Game Night), read-only. Opened from a
 * manager's row in League › Standings / Home's excerpt and from the opponent's half of the
 * Matchup header (lib/game/teamLink); your own row opens your Portfolio tab instead.
 *
 * The Portfolio's rules, minus everything that acts: the money page (`moneyBg`), the hero
 * (their team value, the gain since the draft on the SAME `teamValue.stake` basis as Home and
 * Portfolio, today), their cash, their holdings as roster rows (HoldingRow: no sparklines, no
 * rules between them), each opening the PLAYER CARD (owner = them, no Save, no Sell). No value
 * line and no range pills (the line needs their daily values, and the screen reads, never acts),
 * no Buy a stock, no Trade history. A row whose card can't be whole is a plain row, never a
 * dead tap. Only league members can read a member's team: the league ledger
 * (get_portfolio_ledger, INVOKER + is_member) lists current members only, so a member who left,
 * a missing league and a failed read all land on the same "didn't load" + Try again.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { space } from '@/constants/tokens';
import { Icon } from '@/components/sp/Icon';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { PlayerCard, type PlayerCardOwnership } from '@/components/sp/gn';
import { LoadFailure } from '@/components/money/LoadFailure';
import { HoldingRow, ROW_TEXT_MAX_SCALE } from '@/components/money/HoldingRow';
import { PortfolioSkeleton } from '@/components/money/PortfolioSkeleton';
import { COPY } from '@/lib/money/moneyCopy';
import type { ThemeColors } from '@/constants/tokens/color';
import { MONEY_FIXTURE } from '@/lib/money/devFixture';
import { usePlayerPortfolioData } from '@/lib/money/usePlayerPortfolioData';
import { useHomeLeague } from '@/lib/home/useHomeLeague';
import { useRosterData } from '@/lib/game/useRosterData';
import { useMemberSnapshots } from '@/lib/game/useMemberSnapshots';
import { memberSnapshots, memberTrades } from '@/lib/game/memberWeek';
import { cardSlotPill, etDateOf, weekSessions } from '@/lib/game/matchupRoster';
import { openingOf, playerCardData, stockWeek } from '@/lib/game/playerCardModel';
import { mondayOf } from '@/lib/money/portfolioChart';
import { decideTradeGate } from '@/lib/money/tradeGate';
import { marketOpensLabel } from '@/lib/money/marketOpensLabel';
import { resolveWeekWindow, standardWeekSessions } from '@/lib/time/marketWeek';
import { useLeagueContext } from '@/lib/LeagueContext';
import { SEAM_ON } from '@/lib/game/devSeam';
import { useCaptureAction } from '@/lib/money/captureScript';
import { linkedName } from '@/lib/game/teamLink';
import { Button } from '@/components/sp/Button';
import { WarnPanel } from '@/components/sp/WarnPanel';
import { useAuth } from '@/lib/useAuth';
import { FIND_NEW_MANAGER } from '@/lib/account/deleteCopy';
import { useDeletedManagerLabel } from '@/lib/account/deletedLabelStore';
import { isDeletedSeatName } from '@/lib/account/deletedSeat';
import { canFindNewManager } from '@/lib/account/findManager';
import { useFindNewManager } from '@/lib/account/useFindNewManager';
import { JOIN_COPY } from '@/lib/join/joinPreview';

/** The hero's sub-lines follow Dynamic Type to 1.3× (the value stays the standout), as Portfolio's do. */
const HERO_LINE_MAX_SCALE = 1.3;
const NBSP = '\u00a0';

/** gain/loss/zero -> its theme colour (the Portfolio hero's own mapping). */
function toneColor(colors: ThemeColors, tone: 'gain' | 'loss' | 'zero' | null): string {
  if (tone === 'gain') return colors.gain;
  if (tone === 'loss') return colors.loss;
  return colors.zero;
}

/** A hero sub-line: "+$X · +Y% since the draft". Static (no roll: this screen never live-updates
 * under your eyes). The "·" stays glued to the figure before it, so a wrapped line never starts
 * with one (§5 "Wrapping at XL"). */
function HeroLine({ label, money, pct, words, color }: { label: string; money: string; pct: string; words: string; color: string }) {
  return (
    <View accessible accessibilityLabel={label} style={styles.heroLine}>
      <Text variant="callout" color={color} maxFontSizeMultiplier={HERO_LINE_MAX_SCALE} style={styles.bold}>{`${money}${NBSP}· `}</Text>
      <Text variant="callout" color={color} maxFontSizeMultiplier={HERO_LINE_MAX_SCALE} style={styles.bold}>
        {pct}
        <Text variant="callout" tone="secondary" maxFontSizeMultiplier={HERO_LINE_MAX_SCALE} style={styles.regular}>{`${NBSP}${words}`}</Text>
      </Text>
    </View>
  );
}

export function PlayerPortfolioScreen({ userId, username }: { userId: string; username?: string | null }) {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { market, activeLeague } = useLeagueContext();
  const { user } = useAuth();
  const deletedLabel = useDeletedManagerLabel();
  const data = usePlayerPortfolioData(userId || null);
  const leagueId = data.leagueId;
  // The linked name shows only while loading; a failed load names no one (a crafted link can carry any text).
  const knownName = data.portfolio?.displayName ?? (data.status === 'loading' ? linkedName(username) : null);
  // Account deletion (W4): on a deleted seat's team the COMMISSIONER gets "Find a new manager" (board: under the value).
  const findManager = useFindNewManager(leagueId, activeLeague?.name ?? '');
  const findable = !!activeLeague && canFindNewManager({
    isCommissioner: activeLeague.commissioner_id === user?.id,
    seatDeleted: isDeletedSeatName(data.portfolio?.displayName, deletedLabel),
    draftStatus: activeLeague.draft_status,
    seasonStatus: activeLeague.season_status,
  });

  // The card's week: Matchup's own read for the clock, calendar and live quotes; the
  // leaguemate's own snapshots for their week (a member-gated read).
  const home = useHomeLeague(MONEY_FIXTURE ? null : leagueId);
  const raw = home.raw;
  const week = raw ? raw.data.current_week.week_number : null;
  // Only for a member the ledger confirms: a forged id fires no reads.
  const confirmed = data.status === 'ready' && !!data.portfolio;
  const snaps = useMemberSnapshots(MONEY_FIXTURE || !raw || !confirmed ? null : leagueId, userId || null, week);
  const roster = useRosterData(MONEY_FIXTURE || !confirmed ? null : leagueId, userId || null, null);
  const [selected, setSelected] = useState<string | null>(null);
  // The card stays mounted while it leaves, with the stock it was showing.
  const [shown, setShown] = useState<string | null>(null);

  const now = SEAM_ON && raw ? raw.now : new Date();
  const todayEt = etDateOf(now) ?? now.toISOString().slice(0, 10);
  const calendar = useMemo(() => raw?.marketCalendar ?? [], [raw]);
  const window = useMemo(() => resolveWeekWindow(now.toISOString(), calendar), [calendar, todayEt]); // eslint-disable-line react-hooks/exhaustive-deps
  const sessions = useMemo(() => {
    const fromCalendar = window ? weekSessions(window.weekStart, window.weekEnd, calendar) : [];
    return fromCalendar.length ? fromCalendar : standardWeekSessions(`${mondayOf(todayEt)}T16:00:00Z`);
  }, [window, calendar, todayEt]);

  const ledger = data.ledger;
  // A card can be whole when the ledger names how they got the stock, the stock has a price,
  // and the week's reads are in. Otherwise the row is information only.
  const cardReady = !!ledger && !!raw && snaps.status === 'ready';
  const priceOf = (symbol: string) => data.prices[symbol] ?? raw?.quote(symbol) ?? null;
  const canOpen = (symbol: string) => cardReady && openingOf(userId, symbol, ledger!.activity) !== null && priceOf(symbol) != null;

  const card = useMemo(() => {
    if (!shown || !ledger || !raw || snaps.status !== 'ready') return null;
    const price = data.prices[shown] ?? raw.quote(shown);
    if (price == null) return null;
    const snapshots = memberSnapshots(snaps.rows);
    const trades = window ? memberTrades(ledger.activity, userId, window.weekStart, window.weekEnd) : [];
    const cardData = playerCardData({
      symbol: shown,
      company: ledger.symbol_names[shown] ?? '',
      userId,
      activity: ledger.activity,
      snapshots,
      trades,
      weekGain: stockWeek(shown, snapshots, trades, price).gain,
      price,
      bars: data.bars[shown] ?? raw.bars[shown] ?? [],
      seasonBars: data.bars[shown] ?? null,
      sessions,
      now,
    });
    if (!cardData) return null;
    const slotId = roster.slots.bySide[userId]?.[shown] ?? null;
    return { data: cardData, pill: cardSlotPill(roster.slots.slots.find((s) => s.id === slotId) ?? null) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, ledger, raw, snaps.status, snaps.rows, data.prices, data.bars, window, sessions, roster.slots, userId]);

  function pillFor(symbol: string) {
    const slotId = roster.slots.bySide[userId]?.[symbol] ?? null;
    return cardSlotPill(roster.slots.slots.find((s) => s.id === slotId) ?? null);
  }

  // The week's reads failing leaves rows as information only, with Try again at the foot of the list.
  const retry = () => {
    data.refresh();
    snaps.retry();
    roster.retry();
  };
  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/portfolio'));

  // DEV capture only (captureScript): the same handlers a tap runs.
  const scrollRef = useRef<ScrollView>(null);
  useCaptureAction('card', (sym) => { if (sym && canOpen(sym)) { setSelected(sym); setShown(sym); } });
  useCaptureAction('closecard', () => setSelected(null));
  useCaptureAction('close', close);
  useCaptureAction('scroll', (y) => scrollRef.current?.scrollTo({ y: Number(y) || 0, animated: false }));

  let body: React.ReactNode;
  if (data.status === 'loading') {
    body = <PortfolioSkeleton label={COPY.teamLoading(knownName)} chart={false} />;
  } else if (data.status === 'error' || !data.portfolio) {
    body = <LoadFailure title={COPY.teamLoadTitle(knownName)} message={COPY.loadRetryMessage} onRetry={retry} />;
  } else {
    const p = data.portfolio;
    const v = p.view;
    body = (
      <View style={styles.blocks}>
        <View style={styles.heroText}>
          <Text variant="caption" tone="secondary" maxFontSizeMultiplier={HERO_LINE_MAX_SCALE}>{v.valueLabel}</Text>
          <Text variant="money" accessibilityRole="header" accessibilityLabel={`${v.valueLabel}, ${v.valueText}`} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{v.valueText}</Text>
          {v.gainMoneyText && v.gainPctText ? (
            <HeroLine label={`${v.gainText} ${v.sinceDraftLabel}`} money={v.gainMoneyText} pct={v.gainPctText} words={v.sinceDraftLabel} color={toneColor(colors, v.gainTone)} />
          ) : null}
          {v.todayMoneyText && v.todayPctText ? (
            <HeroLine label={`${v.todayText} today`} money={v.todayMoneyText} pct={v.todayPctText} words="today" color={toneColor(colors, v.todayTone)} />
          ) : null}
          {v.unpricedNote ? <Text variant="caption" tone="secondary" maxFontSizeMultiplier={HERO_LINE_MAX_SCALE}>{v.unpricedNote}</Text> : null}
        </View>

        {findable ? (
          <View style={styles.findBlock}>
            <Button label={FIND_NEW_MANAGER} status={findManager.busyId ? 'loading' : 'idle'} onPress={() => void findManager.find(userId)} fullWidth />
            {findManager.failed ? <WarnPanel text={JOIN_COPY.unreachable} /> : null}
          </View>
        ) : null}

        {v.cashValueText ? (
          <View style={styles.factRow} accessible accessibilityLabel={`${COPY.cashFromSales}, ${v.cashValueText}`}>
            <Text variant="callout" tone="secondary" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE}>{COPY.cashFromSales}</Text>
            <Text variant="score.sm" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE} style={styles.bold}>{v.cashValueText}</Text>
          </View>
        ) : null}

        <View>
          <View style={styles.listHead}>
            <Text variant="headline" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE} style={styles.extraBold}>{COPY.holdingsHeading}</Text>
            {v.rows.length ? <Text variant="caption" tone="secondary" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE}>Value · today</Text> : null}
          </View>
          {v.rows.map((r) => (
            <HoldingRow
              key={r.symbol}
              row={r}
              pill={pillFor(r.symbol)}
              onPress={canOpen(r.symbol) ? () => { setSelected(r.symbol); setShown(r.symbol); } : undefined}
            />
          ))}
        </View>
        <Text variant="caption" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE} tone="secondary" style={styles.center}>{v.creditText}</Text>
      </View>
    );
  }

  const gate = decideTradeGate(new Date(), market);
  // Theirs: no Save (the app has no watchlist yet) and never Sell; the card only informs.
  const ownership: PlayerCardOwnership | null = card && knownName ? { owner: { name: knownName }, save: null } : null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.moneyBg }]}>
      <View style={[styles.header, { paddingTop: insets.top + space[3] }]}>
        <Text variant="title" numberOfLines={2} maxFontSizeMultiplier={1.3} accessibilityRole="header" style={styles.title}>
          {knownName ? `${knownName}${data.portfolio?.isBot ? ' · Bot' : ''}` : ' '}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={COPY.teamClose} onPress={close} hitSlop={4} style={styles.closeBtn} testID="team-view-close">
          <Icon name="close" size="headline" tone="text2" />
        </Pressable>
      </View>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>{body}</ScrollView>
      {card && ownership ? (
        <PlayerCard
          {...card.data}
          {...ownership}
          {...(card.pill ?? {})}
          visible={selected !== null}
          onClose={() => setSelected(null)}
          onClosed={() => setShown(null)}
          marketOpen={SEAM_ON ? false : gate.open}
          opens={marketOpensLabel(market?.next_open_at ?? null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[4], paddingHorizontal: space[6], paddingBottom: space[3] },
  title: { flex: 1, minWidth: 0, fontWeight: '800' },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: space[6], paddingTop: space[2], paddingBottom: space[9] },
  blocks: { gap: space[7] },
  heroText: { gap: space[1] },
  findBlock: { gap: space[3] },
  factRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', columnGap: space[3] },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: space[1] },
  heroLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' },
  bold: { fontWeight: '700' },
  regular: { fontWeight: '400' },
  extraBold: { fontWeight: '800' },
  center: { textAlign: 'center' },
});
