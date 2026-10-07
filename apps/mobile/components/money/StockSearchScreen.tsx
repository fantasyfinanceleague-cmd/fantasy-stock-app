/**
 * StockSearchScreen: the buy entry point (3e STEP 2). A search field and its
 * results laid out INLINE below it, never an overlay (the Design Lead's
 * preference, G-14; the overlay in components/SymbolSearchField.tsx also
 * clips inside a Card, which this screen has no Card to clip against anyway).
 * Reuses the shared search data (useMoneyStockSearch, seamed for the fixture)
 * and the shared result shaping (lib/symbolSearch.ts) — only the layout is
 * new. Every result is selectable except a non-draftable symbol: ownership is
 * never checked here, the same way a held or another manager's symbol opens
 * the sheet and lets the server's refusal (and its next step) speak.
 *
 * Tapping a result opens the stock sheet, which defaults to Buy for any
 * symbol the caller doesn't hold (stockSheetModel).
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ListRow } from '@/components/sp/ListRow';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { ShellHeader } from '@/components/shell/ShellHeader';
import { useStockSheet } from '@/components/money/MoneyHost';
import { LoadFailure } from '@/components/money/LoadFailure';
import { COPY } from '@/lib/money/moneyCopy';
import { useMoneyStockSearch } from '@/lib/money/useMoneyStockSearch';
import type { ShapedSearchResult } from '@/lib/symbolSearch';

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  input: { minHeight: 44, borderRadius: 10, paddingHorizontal: 14, fontSize: 17, borderWidth: 1 },
  results: { gap: 0 },
  disabled: { opacity: 0.5 },
  empty: { paddingVertical: 24, alignItems: 'center' },
  skeletonRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  skeletonLogo: { width: 36, height: 36, borderRadius: 18 },
  skeletonLines: { flex: 1, gap: 6 },
  skeletonBar: { borderRadius: 6 },
});

export function StockSearchScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { open } = useStockSheet();
  const [query, setQuery] = useState('');
  const { results, loading, error, retry } = useMoneyStockSearch(query, '');

  function handleSelect(item: ShapedSearchResult) {
    if (!item.selectable) return;
    open(item.symbol, { name: item.name, originRef: 'stock-search' });
    router.back();
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ShellHeader title={COPY.stockSearchTitle} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={8} style={styles.back}>
          <Text variant="callout" tone="primary">Back</Text>
        </Pressable>

        <TextInput
          style={[styles.input, { backgroundColor: colors.inset, color: colors.text, borderColor: colors.border }]}
          value={query}
          onChangeText={(t) => setQuery(t.toUpperCase())}
          placeholder={COPY.stockSearchPlaceholder}
          placeholderTextColor={colors.text2}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
        />

        {/* E-1 (3e UX audit): a failed search is its own framed state, never "no matches". */}
        {error ? (
          <LoadFailure title={COPY.stockSearchLoadTitle} message={COPY.loadRetryMessage} onRetry={retry} />
        ) : query.length > 0 && loading && results.length === 0 ? (
          // E-2: skeleton rows, never a blank screen, while the first results load.
          <View style={styles.results} accessibilityLabel="Loading results">
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.skeletonRow}>
                <View style={[styles.skeletonLogo, { backgroundColor: colors.sunken }]} />
                <View style={styles.skeletonLines}>
                  <View style={[styles.skeletonBar, { width: 64, height: 12, backgroundColor: colors.sunken }]} />
                  <View style={[styles.skeletonBar, { width: 140, height: 10, backgroundColor: colors.sunken }]} />
                </View>
                <View style={[styles.skeletonBar, { width: 56, height: 12, backgroundColor: colors.sunken }]} />
              </View>
            ))}
          </View>
        ) : query.length > 0 && !loading && results.length === 0 ? (
          <View style={styles.empty}>
            <Text variant="callout" tone="secondary">{COPY.noMatchingStocks}</Text>
          </View>
        ) : (
          <View style={styles.results}>
            {results.map((item) => (
              <View key={item.symbol} style={!item.selectable ? styles.disabled : undefined}>
                <ListRow
                  title={item.symbol}
                  subtitle={item.badgeLabel ? `${item.name} · ${item.badgeLabel}` : item.name}
                  trailing={item.price != null ? <Text variant="callout">{`$${item.price.toFixed(2)}`}</Text> : undefined}
                  onPress={item.selectable ? () => handleSelect(item) : undefined}
                  hideChevron
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
