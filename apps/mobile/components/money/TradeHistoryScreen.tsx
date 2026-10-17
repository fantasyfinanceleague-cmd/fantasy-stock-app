/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
/**
 * TradeHistoryScreen: the caller's trades and draft picks for the active league (3e; W4, Game
 * Night — the DL ruled it's not optional for 1.3: "No screen mixes skins"). The list is
 * virtualised and pages as the user scrolls: each page reveals 50 more rows, so a 1,000-row
 * history is never rendered at once and is never truncated. Filters: All, Buys, Sells, Draft.
 *
 * Game Night: the money page (`moneyBg`); "‹ Portfolio" in the accent; the title; the filters
 * as the money screens' pill SegmentedControl (neutral selected); day headers; rows like
 * Portfolio's (the ticker disc, "Bought NVDA" / "Sold V" / "Drafted AAPL", the time · shares at
 * a price, the amount at 700), divided by space, never rules. The rows are records, not
 * buttons (no chevron). Loading: skeleton rows; failed: LoadFailure; empty: the app's line.
 * No new copy.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { space } from '@/constants/tokens';
import { LoadFailure } from '@/components/money/LoadFailure';
import { ROW_TEXT_MAX_SCALE } from '@/components/money/HoldingRow';
import { Skeleton } from '@/components/Skeleton';
import { keepMoney } from '@/lib/game/keepDots';
import { Icon } from '@/components/sp/Icon';
import { SegmentedControl } from '@/components/sp/SegmentedControl';
import { Text } from '@/components/sp/Text';
import { formatMoney } from '@/components/sp/logic/money';
import { useTheme } from '@/components/sp/ThemeProvider';
import { ShellHeader } from '@/components/shell/ShellHeader';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useSession } from '@/lib/SessionProvider';
import { formatShares } from '@/lib/money/formatShares';
import { COPY } from '@/lib/money/moneyCopy';
import { historyItems, historyRows, historyTotal, todayEtIso, type HistoryFilter, type HistoryItem, type HistoryRow } from '@/lib/money/tradeHistory';
import { usePortfolioLedger } from '@/lib/money/usePortfolioLedger';
import { MONEY_FIXTURE } from '@/lib/money/devFixture';
import { FIXTURE_LEAGUE_ID } from '@/lib/money/fixtureMode';
import { STRESS_CALLER } from '@/lib/money/stressFixture';
import { useCaptureAction } from '@/lib/money/captureScript';

/** Rows revealed per page. The list pages as the user scrolls; nothing is cut off. */
export const HISTORY_PAGE = 50;

const FILTERS: { label: string; value: HistoryFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Buys', value: 'buys' },
  { label: 'Sells', value: 'sells' },
  { label: 'Draft', value: 'draft' },
];

/** The history's text follows Dynamic Type to 1.6× (the sheet's ceiling); rows keep 1.3×. */
const HISTORY_TEXT_MAX_SCALE = 1.6;

function ItemRow({ item }: { item: HistoryItem }) {
  const { colors } = useTheme();
  const label = item.kind === 'draft'
    ? COPY.tradeDrafted(item.symbol)
    : item.action === 'sell' ? COPY.tradeSold(item.symbol) : COPY.tradeBought(item.symbol);
  const price = item.price != null ? formatMoney(item.price) : null;
  const detail = [
    item.timeLabel,
    `${formatShares(item.quantity)} sh${price ? ` at ${price}` : ''}`,
  ].filter(Boolean).join(' · ');
  const total = historyTotal(item);
  return (
    <View style={styles.item} accessible accessibilityLabel={`${label}, ${detail}${total != null ? `, ${formatMoney(total)}` : ''}`}>
      <View style={[styles.disc, { backgroundColor: colors.inset }]}>
        <Text variant="ticker.tile" allowFontScaling={false} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{item.symbol}</Text>
      </View>
      <View style={styles.itemLead}>
        <Text variant="callout" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE} style={styles.extraBold}>{label}</Text>
        <Text variant="caption" tone="secondary" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE} style={styles.tabular}>{keepMoney(detail)}</Text>
      </View>
      {total != null ? (
        <Text variant="score.sm" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE} style={styles.money}>{keepMoney(formatMoney(total))}</Text>
      ) : null}
    </View>
  );
}

function HistorySkeleton() {
  return (
    <View style={styles.skeleton} accessible accessibilityLabel={COPY.historyPending} accessibilityState={{ busy: true }}>
      <Skeleton width={90} height={16} />
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.item}>
          <Skeleton width={40} height={40} borderRadius={20} />
          <View style={styles.itemLead}>
            <Skeleton width={110} height={14} />
            <Skeleton width={170} height={12} />
          </View>
          <Skeleton width={70} height={14} />
        </View>
      ))}
    </View>
  );
}

export function TradeHistoryScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { activeLeague } = useLeagueContext();
  const { user } = useSession();
  const ledger = usePortfolioLedger(activeLeague?.id ?? (MONEY_FIXTURE ? FIXTURE_LEAGUE_ID : null));
  // DEV fixture: the stress caller's rows.
  const callerId = MONEY_FIXTURE ? STRESS_CALLER : (user?.id ?? null);
  const [filterIndex, setFilterIndex] = useState(0);
  const [revealed, setRevealed] = useState(HISTORY_PAGE);
  const filter = FILTERS[filterIndex].value;

  function choose(v: string) {
    const next = FILTERS.findIndex((f) => f.value === v);
    setFilterIndex(next < 0 ? 0 : next);
    setRevealed(HISTORY_PAGE);
  }
  // DEV capture only (captureScript): the filter a tap picks.
  useCaptureAction('filter', (v) => choose(v ?? 'all'));

  const items = useMemo(
    () => (ledger.ledger && callerId ? historyItems(ledger.ledger.activity, callerId, filter) : []),
    [ledger.ledger, callerId, filter],
  );
  const visible = items.slice(0, revealed);
  const rows: HistoryRow[] = useMemo(() => historyRows(visible, todayEtIso() ?? ''), [visible]);

  let body: React.ReactNode;
  if (ledger.status === 'loading') {
    body = <HistorySkeleton />;
  } else if (ledger.status === 'error' || !ledger.ledger) {
    body = (
      <View style={styles.pad}>
        <LoadFailure title={COPY.portfolioLoadTitle} message={COPY.loadRetryMessage} onRetry={ledger.refresh} />
      </View>
    );
  } else {
    body = (
      <FlatList
        data={rows}
        keyExtractor={(r, i) => (r.kind === 'header' ? `h:${r.key}` : `i:${r.item.id}:${i}`)}
        renderItem={({ item: r }) =>
          r.kind === 'header' ? (
            <Text variant="headline" maxFontSizeMultiplier={HISTORY_TEXT_MAX_SCALE} accessibilityRole="header" style={styles.section}>{r.title}</Text>
          ) : (
            <ItemRow item={r.item} />
          )
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (revealed < items.length) setRevealed((n) => Math.min(items.length, n + HISTORY_PAGE));
        }}
        ListEmptyComponent={
          <Text variant="callout" maxFontSizeMultiplier={HISTORY_TEXT_MAX_SCALE} tone="secondary" style={styles.empty}>{COPY.historyEmpty}</Text>
        }
        ListFooterComponent={rows.length ? (
          // The Alpaca credit on every price surface (PRODUCT_RULES).
          <Text variant="caption" maxFontSizeMultiplier={HISTORY_TEXT_MAX_SCALE} tone="secondary" style={styles.credit}>{COPY.alpacaCredit}</Text>
        ) : null}
        contentContainerStyle={styles.list}
      />
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.moneyBg }]}>
      <ShellHeader title={COPY.tradeHistory} />
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Portfolio" onPress={() => router.back()} hitSlop={4} style={styles.back}>
          <Icon name="chevronLeft" size="callout" tone="accent" />
          <Text variant="callout" maxFontSizeMultiplier={HISTORY_TEXT_MAX_SCALE} color={colors.accent} style={styles.bold}>Portfolio</Text>
        </Pressable>
        <Text variant="title" accessibilityRole="header">{COPY.tradeHistory}</Text>
        <SegmentedControl
          shape="pill"
          options={FILTERS.map((f) => ({ label: f.label, value: f.value }))}
          value={FILTERS[filterIndex].value}
          onChange={choose}
        />
      </View>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: space[6], paddingTop: space[2], gap: space[3] },
  back: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space[1], alignSelf: 'flex-start' },
  list: { paddingHorizontal: space[6], paddingBottom: space[9] },
  pad: { paddingHorizontal: space[6], paddingTop: space[5] },
  section: { paddingTop: space[6], paddingBottom: space[2], fontWeight: '800' },
  item: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space[4], paddingVertical: space[3] },
  disc: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[1] },
  itemLead: { flex: 1, minWidth: 0, gap: space[1] },
  skeleton: { paddingHorizontal: space[6], paddingTop: space[6], gap: space[1] },
  empty: { paddingTop: space[7], textAlign: 'center' },
  credit: { paddingTop: space[6], textAlign: 'center' },
  money: { fontWeight: '700' },
  bold: { fontWeight: '700' },
  extraBold: { fontWeight: '800' },
  tabular: { fontVariant: ['tabular-nums'] },
});
