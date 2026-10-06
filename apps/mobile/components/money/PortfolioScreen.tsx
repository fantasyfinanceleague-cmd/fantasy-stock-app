/**
 * PortfolioScreen: the Portfolio tab (3e). Renders usePortfolioData's view and
 * nothing else: every figure comes from portfolioView, and every row opens the
 * stock sheet through the one route, passing the name the row already shows.
 *
 * Not yet built: the trade-history link, the Cash row for per-slot sales (it
 * needs the open-proceeds read), and the value-roll and reorder motion.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { ShellHeader } from '@/components/shell/ShellHeader';
import { useStockSheet } from '@/components/money/MoneyHost';
import { Icon } from '@/components/sp/Icon';
import { useRouter } from 'expo-router';
import { LoadFailure } from '@/components/money/LoadFailure';
import { COPY } from '@/lib/money/moneyCopy';
import { usePortfolioData } from '@/lib/money/usePortfolioData';

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  stack: { gap: 10 },
  list: { gap: 0 },
  row: {
    minHeight: 44,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLead: { flex: 1, paddingRight: 12 },
  rowTrail: { alignItems: 'flex-end' },
  historyLink: { minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
});

export function PortfolioScreen() {
  const { colors } = useTheme();
  const data = usePortfolioData();
  const { open } = useStockSheet();
  const router = useRouter();

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
        <Text variant="display">{v.valueText}</Text>

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

        <Text variant="headline">{COPY.holdingsHeading}</Text>
        <View style={styles.list}>
          {v.rows.map((r) => (
            <Pressable
              key={r.symbol}
              accessibilityRole="button"
              accessibilityLabel={`${r.symbol}, ${r.name}, ${r.quantityText} shares, ${r.valueText}${r.todayText ? `, ${r.todayText} today` : ''}`}
              onPress={() => open(r.symbol, { name: r.name, originRef: r.symbol })}
              style={({ pressed }) => [styles.row, { borderBottomColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <View style={styles.rowLead}>
                <Text variant="callout">{r.symbol}</Text>
                <Text variant="caption" tone="secondary">{r.name}</Text>
              </View>
              <View style={styles.rowTrail}>
                <Text variant="callout">{r.valueText}</Text>
                <Text variant="caption" tone="secondary">
                  {r.quantityText} sh{r.todayText ? ` · ${r.todayText}` : ''}
                </Text>
              </View>
            </Pressable>
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
