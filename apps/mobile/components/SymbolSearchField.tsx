/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles`/`cardShadow` are declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useSymbolSearch, type UseSymbolSearchOptions } from '@/lib/useSymbolSearch';
import type { ShapedSearchResult } from '@/lib/symbolSearch';

interface SymbolSearchFieldProps extends UseSymbolSearchOptions {
  /** Controlled input text (typically uppercase — matches both call sites'
   * existing autoCapitalize="characters" convention). */
  value: string;
  onChangeText: (text: string) => void;
  /** Fired only for a SELECTABLE result. Unselectable rows (already owned, or
   * not draftable) are shown dimmed with a badge, not hidden — the user
   * should see why a stock can't be picked, matching the app's "show, don't
   * hide" convention for ineligible state — but tapping one does nothing. */
  onSelect: (result: ShapedSearchResult) => void;
  /** The currently-confirmed symbol, if any — suppresses re-searching when
   * the input still matches it (TradeModal's original guard). */
  selectedSymbol?: string;
  placeholder?: string;
  /** OR'd into the field's own search-loading spinner — for a caller's own
   * follow-up fetch (e.g. TradeModal's post-select quote fetch). */
  extraLoading?: boolean;
}

export default function SymbolSearchField({
  value,
  onChangeText,
  onSelect,
  selectedSymbol = '',
  placeholder = 'Search by ticker or name...',
  extraLoading = false,
  ownedSymbols,
  allowUndraftable,
  ownedBadgeLabel,
  debounceMs,
  limit,
}: SymbolSearchFieldProps) {
  const [showResults, setShowResults] = useState(false);
  const { results, loading } = useSymbolSearch(value, selectedSymbol, {
    ownedSymbols,
    allowUndraftable,
    ownedBadgeLabel,
    debounceMs,
    limit,
  });

  const handleChangeText = (text: string) => {
    const upper = text.toUpperCase();
    onChangeText(upper);
    setShowResults(true);
  };

  // G-10 (pass-2b gate, §9A): every colour from the theme, so Dark is dark here too.
  const { colors, elevation } = useTheme();

  const handleSelect = (result: ShapedSearchResult) => {
    if (!result.selectable) return;
    setShowResults(false);
    Keyboard.dismiss();
    onSelect(result);
  };

  const visible = showResults && value.length >= 1 && value.toUpperCase() !== selectedSymbol.toUpperCase();

  return (
    <View style={styles.container}>
      <TextInput
        style={[styles.textInput, { backgroundColor: colors.inset, color: colors.text, borderColor: colors.border }]}
        value={value}
        onChangeText={handleChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.text2}
        autoCapitalize="characters"
        autoCorrect={false}
        onFocus={() => {
          if (value && value.toUpperCase() !== selectedSymbol.toUpperCase()) setShowResults(true);
        }}
      />
      {(loading || extraLoading) && value.length > 0 && (
        <ActivityIndicator size="small" color={colors.accent} style={styles.spinner} />
      )}

      {visible && results.length > 0 && (
        <View style={[styles.resultsContainer, { backgroundColor: colors.surface, borderColor: colors.line }, elevation.card]}>
          <ScrollView style={styles.resultsList} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {results.map((item) => (
              <TouchableOpacity
                key={item.symbol}
                style={[styles.resultItem, { borderBottomColor: colors.line }, !item.selectable && styles.resultItemDisabled]}
                onPress={() => handleSelect(item)}
                disabled={!item.selectable}
              >
                <View style={styles.resultLeft}>
                  <View style={styles.resultSymbolRow}>
                    <Text style={[styles.resultSymbol, { color: colors.text }]}>{item.symbol}</Text>
                    {item.badgeLabel && (
                      <Text style={[styles.badge, { color: colors.warnText, borderColor: colors.warnText }]}>{item.badgeLabel}</Text>
                    )}
                  </View>
                  <Text style={[styles.resultName, { color: colors.text2 }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                </View>
                {item.price ? <Text style={[styles.resultPrice, { color: colors.text2 }]}>${item.price.toFixed(2)}</Text> : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {visible && !loading && results.length === 0 && (
        <View style={[styles.noResultsContainer, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <Text style={[styles.noResultsText, { color: colors.text2 }]}>No matching stocks found</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: 10,
  },
  textInput: {
    borderRadius: 8,
    padding: 14,
    fontSize: 18,
    fontFamily: 'Inter_400Regular',
    borderWidth: 1,
  },
  spinner: {
    position: 'absolute',
    right: 14,
    top: 12,
  },
  resultsContainer: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    borderWidth: 1,
    borderTopWidth: 0,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    maxHeight: 250,
    zIndex: 100,
  },
  resultsList: {
    maxHeight: 250,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
  },
  resultItemDisabled: {
    opacity: 0.5,
  },
  resultLeft: {
    flex: 1,
    marginRight: 12,
  },
  resultSymbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  resultSymbol: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  badge: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  resultName: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  resultPrice: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
  },
  noResultsContainer: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    borderWidth: 1,
    borderTopWidth: 0,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    padding: 16,
    zIndex: 100,
  },
  noResultsText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
});
