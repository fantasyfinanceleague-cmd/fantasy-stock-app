/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
/**
 * StockSearchScreen: the buy entry point (3e STEP 2; W4, Game Night). A search field and its
 * results laid out INLINE below it, never an overlay (the Design Lead's preference, G-14).
 * Reuses the shared search data (useMoneyStockSearch, seamed for the fixtures) and the shared
 * result shaping (lib/symbolSearch.ts).
 *
 * Every result says who owns it (board #buy-a-stock, the Design Lead's ruling): "You own
 * this" in your colour (it opens the sheet on Sell: sell-from-search, ruled A), "Owned by
 * {name}" (tappable, to look; the sheet says why Buy is blocked), "No free slot" when every
 * slot of yours is held (W4; the sheet names the next step), or nothing when it's free. Only a
 * stock that isn't in the league's list is dimmed and can't be tapped ("Not in this league's
 * list"): it's disabled WITH its reason, never a silent row.
 *
 * Game Night: the money page (`moneyBg`); the field on `inset` with the accent edge while
 * focused; rows like Portfolio's (the ticker disc, the ticker, the status line, the company,
 * the price at 800, tabular), no rule lines between them and no sparklines.
 */
import React, { useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { radius, space } from '@/constants/tokens';
import { Icon } from '@/components/sp/Icon';
import { PressableScale } from '@/components/sp/PressableScale';
import { Text } from '@/components/sp/Text';
import { formatMoney } from '@/components/sp/logic/money';
import { useTheme } from '@/components/sp/ThemeProvider';
import { ShellHeader } from '@/components/shell/ShellHeader';
import { useStockSheet } from '@/components/money/MoneyHost';
import { LoadFailure } from '@/components/money/LoadFailure';
import { ROW_TEXT_MAX_SCALE } from '@/components/money/HoldingRow';
import { Skeleton } from '@/components/Skeleton';
import { keepMoney } from '@/lib/game/keepDots';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useSession } from '@/lib/SessionProvider';
import { COPY } from '@/lib/money/moneyCopy';
import { useMoneyStockSearch } from '@/lib/money/useMoneyStockSearch';
import { usePortfolioLedger } from '@/lib/money/usePortfolioLedger';
import { sheetInputsFromLedger } from '@/lib/money/portfolioLedger';
import { deriveStockSheetFacts } from '@/lib/money/stockSheetFacts';
import { ownershipSuffix, type OwnershipSuffix } from '@/lib/money/stockSearchOwnership';
import { myHoldingsFromLedger } from '@/lib/money/portfolioModel';
import { MONEY_FIXTURE, MONEY_FIXTURE_CONFIG } from '@/lib/money/devFixture';
import { FIXTURE_LEAGUE_ID, fixtureLeague } from '@/lib/money/fixtureMode';
import { STRESS_CALLER } from '@/lib/money/stressFixture';
import { seamPortfolioLeague } from '@/lib/money/portfolioSeam';
import { MATCHUP_FIXTURE_VARIANT, PORTFOLIO_STAKE_VARIANT, SEAM_ON } from '@/lib/game/devSeam';
import type { ShapedSearchResult } from '@/lib/symbolSearch';
import { useCaptureAction } from '@/lib/money/captureScript';

/** Search's text follows Dynamic Type to 1.6× (the sheet's ceiling); rows keep their 1.3×. */
const SEARCH_TEXT_MAX_SCALE = 1.6;

export function StockSearchScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { open } = useStockSheet();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(true);
  const { results, loading, error, retry } = useMoneyStockSearch(query, '');

  // E-3: ownership in results, from the same league-wide ledger the stock sheet
  // already reads (shared/cached — not a new read, and never a new RPC).
  const { activeLeague } = useLeagueContext();
  const { user } = useSession();
  const leagueId = activeLeague?.id ?? (MONEY_FIXTURE ? FIXTURE_LEAGUE_ID : null);
  const userId = MONEY_FIXTURE ? STRESS_CALLER : (user?.id ?? null);
  const ledgerState = usePortfolioLedger(leagueId);
  const league = MONEY_FIXTURE_CONFIG
    ? fixtureLeague(MONEY_FIXTURE_CONFIG.stake)
    : SEAM_ON
      ? seamPortfolioLeague(PORTFOLIO_STAKE_VARIANT, MATCHUP_FIXTURE_VARIANT)
      : activeLeague;
  // Budget and tier leagues: a buy needs a free slot; with every slot held, a free stock
  // can't be bought until you sell (the sheet's own rosterFull rule).
  const roomless = !!league && !!ledgerState.ledger && !!userId
    && (league.stake_mode === 'budget_cap' || league.stake_mode === 'price_tiers')
    && myHoldingsFromLedger(ledgerState.ledger, userId).length >= league.num_rounds;

  function ownershipFor(symbol: string): OwnershipSuffix {
    if (!ledgerState.ledger || !userId) return { text: null, mine: false };
    const facts = deriveStockSheetFacts({ symbol, userId, ...sheetInputsFromLedger(ledgerState.ledger) });
    return ownershipSuffix(facts.owner, facts.conflict, roomless);
  }

  // DEV capture only (captureScript): type a query, pick a result, as a tap would.
  useCaptureAction('query', (q) => setQuery(q ?? ''));
  useCaptureAction('pick', (sym) => {
    const item = results.find((r) => r.symbol === sym);
    if (item) handleSelect(item);
  });
  useCaptureAction('blur', () => Keyboard.dismiss());

  function handleSelect(item: ShapedSearchResult) {
    if (!item.selectable) return;
    open(item.symbol, { name: item.name, originRef: 'stock-search' });
    router.back();
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.moneyBg }]}>
      <ShellHeader title={COPY.stockSearchTitle} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {/* E-6: one back control, "‹ Portfolio" -- the ShellHeader title never shows while
            a league is active, so the screen's own title goes right below it. */}
        <Pressable accessibilityRole="button" accessibilityLabel="Portfolio" onPress={() => router.back()} hitSlop={4} style={styles.back}>
          <Icon name="chevronLeft" size="callout" tone="accent" />
          <Text variant="callout" maxFontSizeMultiplier={SEARCH_TEXT_MAX_SCALE} color={colors.accent} style={styles.bold}>Portfolio</Text>
        </Pressable>
        {/* C-9 (Design Lead gate): the board's page-title size, not headline. */}
        <Text variant="title">{COPY.stockSearchTitle}</Text>

        <View style={[styles.field, { backgroundColor: colors.inset, borderColor: focused ? colors.accent : colors.rim }]}>
          <Icon name="search" size="body" tone="text2" />
          <TextInput
            style={[styles.input, { color: colors.text }]}
            value={query}
            // E-8 (3e UX audit): kept as typed -- matching is already case-insensitive,
            // both live (symbols-search) and in the fixture (filterStressSearchCatalog).
            onChangeText={setQuery}
            placeholder={COPY.stockSearchPlaceholder}
            placeholderTextColor={colors.text2}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            accessibilityLabel={COPY.stockSearchPlaceholder}
          />
        </View>

        {/* E-1 (3e UX audit): a failed search is its own framed state, never "no matches". */}
        {error ? (
          <LoadFailure title={COPY.stockSearchLoadTitle} message={COPY.loadRetryMessage} onRetry={retry} />
        ) : query.length === 0 ? (
          // Empty: the focused field and its placeholder say what to type (the hint repeated it:
          // dropped at the W4 DL gate).
          null
        ) : loading && results.length === 0 ? (
          // E-2: skeleton rows, never a blank screen, while the first results load.
          <View style={styles.results} accessible accessibilityLabel="Loading results" accessibilityState={{ busy: true }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.skeletonRow}>
                <Skeleton width={40} height={40} borderRadius={20} />
                <View style={styles.skeletonLines}>
                  <Skeleton width={64} height={14} />
                  <Skeleton width={140} height={12} />
                </View>
                <Skeleton width={64} height={14} />
              </View>
            ))}
          </View>
        ) : !loading && results.length === 0 ? (
          // E-7: names what was searched and what to try, whole sentences.
          <View style={styles.empty}>
            <Text variant="headline" maxFontSizeMultiplier={SEARCH_TEXT_MAX_SCALE} style={[styles.center, styles.extraBold]}>{COPY.noStockMatches(query)}</Text>
            <Text variant="callout" maxFontSizeMultiplier={SEARCH_TEXT_MAX_SCALE} tone="secondary" style={styles.center}>{COPY.tryTickerOrName}</Text>
          </View>
        ) : (
          <View style={styles.results}>
            {results.map((item) => {
              // E-3: not in the league's list wins over ownership (it can't be owned if it
              // was never draftable); otherwise who owns it, "No free slot", or nothing.
              // C-2 (Design Lead gate): the status is its OWN line, never joined onto the
              // company name and truncated with it.
              const suffix: OwnershipSuffix = !item.selectable ? { text: COPY.notInLeagueList, mine: false } : ownershipFor(item.symbol);
              return <SearchRow key={item.symbol} item={item} status={suffix} onPress={() => handleSelect(item)} />;
            })}
          </View>
        )}
        {/* The Alpaca credit on every price surface (PRODUCT_RULES), under the results. */}
        {results.length > 0 && !error ? (
          <Text variant="caption" maxFontSizeMultiplier={SEARCH_TEXT_MAX_SCALE} tone="secondary" style={styles.center}>{COPY.alpacaCredit}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** One result: the disc, the ticker, the status on its own line, the company; the price. A
 * stock not in the league's list is dimmed with its reason and isn't a button at all. */
function SearchRow({ item, status, onPress }: { item: ShapedSearchResult; status: OwnershipSuffix; onPress: () => void }) {
  const { colors } = useTheme();
  const off = !item.selectable;
  const label = [item.symbol, item.name, status.text, item.price != null ? formatMoney(item.price) : null].filter(Boolean).join(', ');
  const content = (
    <>
      <View style={[styles.disc, off ? styles.dim : null, { backgroundColor: colors.inset }]}>
        <Text variant="ticker.tile" allowFontScaling={false} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{item.symbol}</Text>
      </View>
      <View style={styles.lead}>
        <Text variant="ticker" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE}>{item.symbol}</Text>
        {status.text ? (
          <Text
            testID="search-row-status"
            variant="caption"
            maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE}
            color={status.mine ? colors.youText : undefined}
            tone={status.mine ? undefined : 'secondary'}
            style={status.mine ? styles.extraBold : styles.bold}
          >
            {status.text}
          </Text>
        ) : null}
        <Text variant="caption" tone="secondary" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE} numberOfLines={1}>{item.name}</Text>
      </View>
      {item.price != null ? (
        <Text variant="score.sm" maxFontSizeMultiplier={ROW_TEXT_MAX_SCALE} style={[styles.price, styles.bold, off ? styles.dim : null]}>{keepMoney(formatMoney(item.price))}</Text>
      ) : null}
      {off ? <View style={styles.chevronSpace} /> : <Icon name="chevronRight" size="callout" tone="text2" />}
    </>
  );
  if (off) {
    return (
      // Not a button. Only the disc and the price dim (W4 DL gate): the reason stays in `text2`
      // at full opacity (dimmed, it fell to 2.44:1 / 2.04:1).
      <View style={styles.row} accessible accessibilityLabel={label} accessibilityState={{ disabled: true }} testID={`search-row-off-${item.symbol}`}>
        {content}
      </View>
    );
  }
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.row} testID={`search-row-${item.symbol}`}>
      {content}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: space[6], paddingTop: space[2], gap: space[5], paddingBottom: space[9] },
  back: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space[1], alignSelf: 'flex-start' },
  field: { minHeight: 48, borderRadius: radius.lg, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: 14 },
  input: { flex: 1, minHeight: 44, fontSize: 17, fontFamily: 'Archivo-Medium' },
  results: { gap: space[1] },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space[4], paddingVertical: space[3] },
  disc: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[1] },
  lead: { flex: 1, minWidth: 0, gap: space[1] },
  price: { flexShrink: 0 },
  chevronSpace: { width: 16 },
  dim: { opacity: 0.45 },
  empty: { paddingVertical: space[7], gap: space[2], alignItems: 'center' },
  skeletonRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space[4], paddingVertical: space[3] },
  skeletonLines: { flex: 1, gap: space[2] },
  bold: { fontWeight: '700' },
  extraBold: { fontWeight: '800' },
  center: { textAlign: 'center' },
});
