/**
 * PortfolioScreen: the Portfolio tab (3e). Renders usePortfolioData's view and
 * nothing else: every figure comes from portfolioView, and every row opens the
 * stock sheet through the one route, passing the name the row already shows.
 *
 * Not yet built: fixed_notional's per-slot open proceeds (which freed slot
 * funds a buy — needs the preview's sources/unfilledSlots, since it's
 * per-slot, not the single cash figure budget_cap/price_tiers show below).
 */
import React, { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { radius } from '@/constants/tokens';
import { ShellHeader } from '@/components/shell/ShellHeader';
import { useStockSheet } from '@/components/money/MoneyHost';
import { Icon } from '@/components/sp/Icon';
import { PressableScale } from '@/components/sp/PressableScale';
import { useRouter } from 'expo-router';
import { LoadFailure } from '@/components/money/LoadFailure';
import { COPY } from '@/lib/money/moneyCopy';
import { usePortfolioData } from '@/lib/money/usePortfolioData';
import { RollingMoney } from '@/components/home/RollingMoney';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useMotion } from '@/components/sp/motion';

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  stack: { gap: 10 },
  list: { gap: 0 },
  row: {
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowPressable: {
    flex: 1,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLead: { flex: 1, paddingRight: 12 },
  rowTrail: { alignItems: 'flex-end' },
  historyLink: { minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  buyLink: { minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  buyTile: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  bold: { fontWeight: '700' },
});

export function PortfolioScreen() {
  const { colors } = useTheme();
  const data = usePortfolioData();
  const { open } = useStockSheet();
  const router = useRouter();
  const { activeLeague } = useLeagueContext();
  const { reduced, duration } = useMotion();
  // M1: each row's native view, measured at tap time (measureInWindow) for the
  // row->header flying tile. A ref per symbol, since the list re-sorts (M5).
  const rowRefs = useRef<Map<string, View | null>>(new Map());

  function openRow(symbol: string, name: string) {
    const el = rowRefs.current.get(symbol);
    if (el) {
      el.measureInWindow((x, y, width, height) => {
        open(symbol, { name, originRef: symbol, originRect: { x, y, width, height } });
      });
    } else {
      open(symbol, { name, originRef: symbol });
    }
  }

  let body: React.ReactNode;
  if (data.status === 'loading') {
    body = <Text variant="callout" tone="secondary">Loading your portfolio</Text>;
  } else if (data.status === 'error' || !data.view) {
    body = <LoadFailure title={COPY.portfolioLoadTitle} message={COPY.loadRetryMessage} onRetry={data.refresh} />;
  } else {
    const v = data.view;
    body = (
      <View style={styles.stack}>
        <Text variant="callout" tone="secondary">{v.valueLabel}</Text>
        {/* M3: the value rolls per changed digit on a quote refresh, never on first paint. */}
        <RollingMoney text={v.valueText} size="display" rollKey={activeLeague?.id ?? ''} />

        {v.gainText ? (
          <Text variant="callout">
            {v.gainText} <Text variant="callout" tone="secondary">{v.sinceDraftLabel}</Text>
          </Text>
        ) : null}
        {v.todayText ? (
          <Text variant="callout">
            {v.todayText} <Text variant="callout" tone="secondary">today</Text>
          </Text>
        ) : null}

        {v.slotsText ? <Text variant="callout">{v.slotsText}</Text> : null}
        {v.perSlotText ? <Text variant="caption" tone="secondary">{v.perSlotText}</Text> : null}
        {v.cashText ? <Text variant="callout">{v.cashText}</Text> : null}
        {v.unpricedNote ? <Text variant="caption" tone="secondary">{v.unpricedNote}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={v.buyRowText ? `${COPY.buyAStock}, ${v.buyRowText}` : COPY.buyAStock}
          onPress={() => router.push('/stock-search')}
          style={({ pressed }) => [styles.buyLink, { borderBottomColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
        >
          {/* C-9 (Design Lead gate, board #buy-a-stock): a search-icon tile in
              accent-tint, matching the board's ks-logo -- the row was plain text. */}
          <View style={[styles.buyTile, { backgroundColor: colors.accentTint }]}>
            <Icon name="search" size="body" tone="accent" />
          </View>
          <View style={styles.rowLead}>
            <Text variant="callout" color={colors.accent} style={styles.bold}>{COPY.buyAStock}</Text>
            {/* E-4 (Design Lead verbatim): per open sale (fixed_notional) or per
                open slot (price_tiers), or the budget left (budget_cap) — never
                a total, since one buy spends exactly one sale's cash or fills
                exactly one slot. buyRowLine composes this from the same preview
                + ledger reads the screen already fetches. */}
            {v.buyRowText ? <Text variant="caption" tone="secondary">{v.buyRowText}</Text> : null}
          </View>
          <Icon name="chevronRight" size="callout" tone="text2" />
        </Pressable>

        <Text variant="headline">{COPY.holdingsHeading}</Text>
        <View style={styles.list}>
          {v.rows.map((r) => (
            // M5: rows FLIP to their new positions when values change the sort (Reduce Motion: they jump).
            <Animated.View key={r.symbol} layout={reduced ? undefined : LinearTransition.duration(duration.base)}>
            <View
              key={r.symbol}
              ref={(el) => { rowRefs.current.set(r.symbol, el); }}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              {/* The row's own press feedback (§4): scale 0.98 + a light haptic. */}
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`${r.symbol}, ${r.name}, ${r.quantityText} shares, ${r.valueText}${r.todayText ? `, ${r.todayText} today` : ''}`}
                onPress={() => openRow(r.symbol, r.name)}
                style={styles.rowPressable}
              >
                <View style={styles.rowLead}>
                  <Text variant="callout">{r.symbol}</Text>
                  <Text variant="caption" tone="secondary">{r.name}</Text>
                </View>
                <View style={styles.rowTrail}>
                  <Text variant="callout">{r.valueText}</Text>
                  <Text variant="caption" tone="secondary">
                    {r.quantityText} sh{r.todayText ? ` · ${r.todayText}` : ''}{r.slotText ? ` · ${r.slotText}` : ''}
                  </Text>
                </View>
              </PressableScale>
            </View>
            </Animated.View>
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${COPY.tradeHistory}, ${COPY.includesDraftPicks}`}
          onPress={() => router.push('/trade-history')}
          style={({ pressed }) => [styles.historyLink, { borderTopColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
        >
          <View style={styles.rowLead}>
            <Text variant="callout">{COPY.tradeHistory}</Text>
            <Text variant="caption" tone="secondary">{COPY.includesDraftPicks}</Text>
          </View>
          <Icon name="chevronRight" size="callout" tone="text2" />
        </Pressable>

        <Text variant="caption" tone="secondary">{v.creditText}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ShellHeader title="Portfolio" showPhase />
      <ScrollView contentContainerStyle={styles.content}>{body}</ScrollView>
    </View>
  );
}
