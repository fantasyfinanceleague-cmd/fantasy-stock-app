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

import { Icon } from '@/components/sp/Icon';
import { ListRow } from '@/components/sp/ListRow';
import { Text } from '@/components/sp/Text';
import { formatMoney } from '@/components/sp/logic/money';
import { useTheme } from '@/components/sp/ThemeProvider';
import { ShellHeader } from '@/components/shell/ShellHeader';
import { useStockSheet } from '@/components/money/MoneyHost';
import { LoadFailure } from '@/components/money/LoadFailure';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useSession } from '@/lib/SessionProvider';
import { COPY } from '@/lib/money/moneyCopy';
import { useMoneyStockSearch } from '@/lib/money/useMoneyStockSearch';
import { usePortfolioLedger } from '@/lib/money/usePortfolioLedger';
import { sheetInputsFromLedger } from '@/lib/money/portfolioLedger';
import { deriveStockSheetFacts } from '@/lib/money/stockSheetFacts';
import { ownershipSuffix } from '@/lib/money/stockSearchOwnership';
import { MONEY_FIXTURE } from '@/lib/money/devFixture';
import { FIXTURE_LEAGUE_ID } from '@/lib/money/fixtureMode';
import { STRESS_CALLER } from '@/lib/money/stressFixture';
import type { ShapedSearchResult } from '@/lib/symbolSearch';

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  back: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
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

  // E-3: ownership in results, from the same league-wide ledger the stock sheet
  // already reads (shared/cached — not a new read, and never a new RPC).
  const { activeLeague } = useLeagueContext();
  const { user } = useSession();
  const leagueId = activeLeague?.id ?? (MONEY_FIXTURE ? FIXTURE_LEAGUE_ID : null);
  const userId = MONEY_FIXTURE ? STRESS_CALLER : (user?.id ?? null);
  const ledgerState = usePortfolioLedger(leagueId);

  function ownershipFor(symbol: string) {
    if (!ledgerState.ledger || !userId) return { text: null, mine: false };
    const facts = deriveStockSheetFacts({ symbol, userId, ...sheetInputsFromLedger(ledgerState.ledger) });
    return ownershipSuffix(facts.owner, facts.conflict);
  }

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
        {/* E-6: one back control, "‹ Portfolio" -- the ShellHeader title never shows while
            a league is active, so the screen's own title goes right below it. */}
        <Pressable accessibilityRole="button" accessibilityLabel="Portfolio" onPress={() => router.back()} hitSlop={8} style={styles.back}>
          <Icon name="chevronLeft" size="callout" tone="text" />
          <Text variant="callout" tone="primary">Portfolio</Text>
        </Pressable>
        {/* C-9 (Design Lead gate): the board's page-title size, not headline. */}
        <Text variant="title">{COPY.stockSearchTitle}</Text>

        <TextInput
          style={[styles.input, { backgroundColor: colors.inset, color: colors.text, borderColor: colors.border }]}
          value={query}
          // E-8 (3e UX audit): kept as typed -- matching is already case-insensitive,
          // both live (symbols-search) and in the fixture (filterStressSearchCatalog).
          onChangeText={setQuery}
          placeholder={COPY.stockSearchPlaceholder}
          placeholderTextColor={colors.text2}
          autoCapitalize="none"
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
          // E-7: names what was searched and what to try, whole sentences.
          <View style={styles.empty}>
            <Text variant="callout" style={{ textAlign: 'center' }}>{COPY.noStockMatches(query)}</Text>
            <Text variant="callout" tone="secondary" style={{ textAlign: 'center' }}>{COPY.tryTickerOrName}</Text>
          </View>
        ) : (
          <View style={styles.results}>
            {results.map((item) => {
              // E-3: not in the league's list wins over ownership (it can't be owned if it
              // was never draftable); otherwise show who owns it, or nothing when it's free.
              // C-2 (Design Lead gate): the status is its OWN line, never joined onto the
              // company name and truncated with it -- "Owned by {name}" must never become
              // "Owned by Ma…" -- and "You own this" carries the `mine` flag's own colour.
              const suffix = !item.selectable ? { text: COPY.notInLeagueList, mine: false } : ownershipFor(item.symbol);
              return (
                <View key={item.symbol} style={!item.selectable ? styles.disabled : undefined}>
                  <ListRow
                    title={item.symbol}
                    subtitle={item.name}
                    subtitle2={suffix.text ? (
                      <Text variant="callout" color={suffix.mine ? colors.youText : undefined} tone={suffix.mine ? undefined : 'secondary'}>
                        {suffix.text}
                      </Text>
                    ) : undefined}
                    trailing={item.price != null ? <Text variant="callout">{formatMoney(item.price)}</Text> : undefined}
                    onPress={item.selectable ? () => handleSelect(item) : undefined}
                    hideChevron
                  />
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
