/**
 * PlayerPortfolioScreen: another manager's portfolio (3e), read-only. The same
 * numbers as the caller's Portfolio, with no trade action and no row taps: a
 * manager can't buy or sell from someone else's portfolio.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { LoadFailure } from '@/components/money/LoadFailure';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { COPY } from '@/lib/money/moneyCopy';
import { usePlayerPortfolioData } from '@/lib/money/usePlayerPortfolioData';

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, paddingBottom: 32, gap: 10 },
  row: { minHeight: 44, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  lead: { flex: 1, paddingRight: 12 },
  trail: { alignItems: 'flex-end' },
});

export function PlayerPortfolioScreen({ userId }: { userId: string }) {
  const { colors } = useTheme();
  const data = usePlayerPortfolioData(userId);

  let body: React.ReactNode;
  if (data.status === 'loading') {
    body = <Text variant="callout" tone="secondary">Loading their portfolio</Text>;
  } else if (data.status === 'error' || !data.portfolio) {
    body = <LoadFailure title={COPY.portfolioLoadTitle} message={COPY.loadRetryMessage} onRetry={data.refresh} />;
  } else {
    const p = data.portfolio;
    const v = p.view;
    body = (
      <View style={{ gap: 10 }}>
        <Text variant="headline">{p.displayName}{p.isBot ? ' · Bot' : ''}</Text>
        <Text variant="callout" tone="secondary">{v.valueLabel}</Text>
        <Text variant="display">{v.valueText}</Text>
        {v.gainText ? (
          <Text variant="callout">
            {v.gainText} <Text variant="callout" tone="secondary">{v.sinceDraftLabel}</Text>
          </Text>
        ) : null}
        {v.unpricedNote ? <Text variant="caption" tone="secondary">{v.unpricedNote}</Text> : null}

        <Text variant="headline">{COPY.holdingsHeading}</Text>
        {v.rows.map((r) => (
          <View key={r.symbol} style={[styles.row, { borderBottomColor: colors.border }]} accessible accessibilityLabel={`${r.symbol}, ${r.name}, ${r.quantityText} shares, ${r.valueText}`}>
            <View style={styles.lead}>
              <Text variant="callout">{r.symbol}</Text>
              <Text variant="caption" tone="secondary">{r.name}</Text>
            </View>
            <View style={styles.trail}>
              <Text variant="callout">{r.valueText}</Text>
              <Text variant="caption" tone="secondary">{r.quantityText} sh{r.todayText ? ` · ${r.todayText}` : ''}</Text>
            </View>
          </View>
        ))}
        <Text variant="caption" tone="secondary">{v.creditText}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={styles.content}>
      {body}
    </ScrollView>
  );
}
