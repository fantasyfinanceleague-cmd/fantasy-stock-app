/**
 * TradeHistoryScreen: the caller's trades and draft picks for the active league
 * (3e). The list is virtualised and pages as the user scrolls: each page reveals
 * 50 more rows, so a 1,000-row history is never rendered at once and is never
 * truncated. Filters are All, Buys, Sells and Draft.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { LoadFailure } from '@/components/money/LoadFailure';
import { SegmentedControl } from '@/components/sp/SegmentedControl';
import { Text } from '@/components/sp/Text';
import { formatMoney } from '@/components/sp/logic/money';
import { useTheme } from '@/components/sp/ThemeProvider';
import { ShellHeader } from '@/components/shell/ShellHeader';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useSession } from '@/lib/SessionProvider';
import { formatShares } from '@/lib/money/formatShares';
import { COPY } from '@/lib/money/moneyCopy';
import { historyItems, historyRows, todayEtIso, type HistoryFilter, type HistoryItem, type HistoryRow } from '@/lib/money/tradeHistory';
import { usePortfolioLedger } from '@/lib/money/usePortfolioLedger';
import { MONEY_FIXTURE } from '@/lib/money/devFixture';
import { FIXTURE_LEAGUE_ID } from '@/lib/money/fixtureMode';
import { STRESS_CALLER } from '@/lib/money/stressFixture';

/** Rows revealed per page. The list pages as the user scrolls; nothing is cut off. */
export const HISTORY_PAGE = 50;

const FILTERS: { label: string; value: HistoryFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Buys', value: 'buys' },
  { label: 'Sells', value: 'sells' },
  { label: 'Draft', value: 'draft' },
];

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  section: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
  item: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between' },
  itemLead: { flex: 1, paddingRight: 12 },
  itemTrail: { alignItems: 'flex-end' },
  empty: { padding: 16 },
});

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
  return (
    <View style={[styles.item, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}
      accessible accessibilityLabel={`${label}, ${detail}${item.total != null ? `, ${formatMoney(item.total)}` : ''}`}>
      <View style={styles.itemLead}>
        <Text variant="callout">{label}</Text>
        <Text variant="caption" tone="secondary">{detail}</Text>
      </View>
      <View style={styles.itemTrail}>
        {item.total != null ? <Text variant="callout">{formatMoney(item.total)}</Text> : null}
      </View>
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

  const items = useMemo(
    () => (ledger.ledger && callerId ? historyItems(ledger.ledger.activity, callerId, filter) : []),
    [ledger.ledger, callerId, filter],
  );
  const visible = items.slice(0, revealed);
  const rows: HistoryRow[] = useMemo(() => historyRows(visible, todayEtIso() ?? ''), [visible]);

  let body: React.ReactNode;
  if (ledger.status === 'loading') {
    body = <Text variant="callout" tone="secondary" style={styles.empty}>{COPY.historyPending}</Text>;
  } else if (ledger.status === 'error' || !ledger.ledger) {
    body = <LoadFailure title={COPY.portfolioLoadTitle} message={COPY.loadRetryMessage} onRetry={ledger.refresh} />;
  } else {
    body = (
      <FlatList
        data={rows}
        keyExtractor={(r, i) => (r.kind === 'header' ? `h:${r.key}` : `i:${r.item.id}:${i}`)}
        renderItem={({ item: r }) =>
          r.kind === 'header' ? (
            <Text variant="headline" style={styles.section}>{r.title}</Text>
          ) : (
            <ItemRow item={r.item} />
          )
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (revealed < items.length) setRevealed((n) => Math.min(items.length, n + HISTORY_PAGE));
        }}
        ListEmptyComponent={
          <Text variant="callout" tone="secondary" style={styles.empty}>{COPY.historyEmpty}</Text>
        }
        contentContainerStyle={{ paddingBottom: 32 }}
      />
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ShellHeader title={COPY.tradeHistory} />
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Portfolio" onPress={() => router.back()} hitSlop={8} style={styles.back}>
          <Text variant="callout" tone="primary">Portfolio</Text>
        </Pressable>
        <SegmentedControl
          options={FILTERS.map((f) => ({ label: f.label, value: f.value }))}
          value={FILTERS[filterIndex].value}
          onChange={(v) => {
            const next = FILTERS.findIndex((f) => f.value === v);
            setFilterIndex(next < 0 ? 0 : next);
            setRevealed(HISTORY_PAGE);
          }}
        />
      </View>
      {body}
    </View>
  );
}
