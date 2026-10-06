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
});

export function PortfolioScreen() {
  const { colors } = useTheme();
  const data = usePortfolioData();
  const { open } = useStockSheet();

  let body: React.ReactNode;
  if (data.status === 'loading') {
    body = <Text variant="callout" tone="secondary">Loading your portfolio</Text>;
  } else if (data.status === 'error' || !data.view) {
    body = <Text variant="callout" tone="secondary">{COPY.cantReach}</Text>;
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
