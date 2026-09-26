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
import { Colors } from '@/constants/Colors';
import { shadows } from '@/constants/theme';
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
        style={styles.textInput}
        value={value}
        onChangeText={handleChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        autoCapitalize="characters"
        autoCorrect={false}
        onFocus={() => {
          if (value && value.toUpperCase() !== selectedSymbol.toUpperCase()) setShowResults(true);
        }}
      />
      {(loading || extraLoading) && value.length > 0 && (
        <ActivityIndicator size="small" color={Colors.primary} style={styles.spinner} />
      )}

      {visible && results.length > 0 && (
        <View style={styles.resultsContainer}>
          <ScrollView style={styles.resultsList} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {results.map((item) => (
              <TouchableOpacity
                key={item.symbol}
                style={[styles.resultItem, !item.selectable && styles.resultItemDisabled]}
                onPress={() => handleSelect(item)}
                disabled={!item.selectable}
              >
                <View style={styles.resultLeft}>
                  <View style={styles.resultSymbolRow}>
                    <Text style={styles.resultSymbol}>{item.symbol}</Text>
                    {item.badgeLabel && (
                      <Text style={styles.badge}>{item.badgeLabel}</Text>
                    )}
                  </View>
                  <Text style={styles.resultName} numberOfLines={1}>
                    {item.name}
                  </Text>
                </View>
                {item.price ? <Text style={styles.resultPrice}>${item.price.toFixed(2)}</Text> : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {visible && !loading && results.length === 0 && (
        <View style={styles.noResultsContainer}>
          <Text style={styles.noResultsText}>No matching stocks found</Text>
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
    backgroundColor: Colors.inputBg,
    borderRadius: 8,
    padding: 14,
    fontSize: 18,
    fontFamily: 'Inter_400Regular',
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
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
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderTopWidth: 0,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    maxHeight: 250,
    zIndex: 100,
    ...shadows.cardLifted,
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
    borderBottomColor: Colors.border,
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
    color: Colors.textPrimary,
  },
  badge: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: Colors.warning,
    borderWidth: 1,
    borderColor: Colors.warning,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  resultName: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    marginTop: 2,
  },
  resultPrice: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
    color: Colors.textSecondary,
  },
  noResultsContainer: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderTopWidth: 0,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    padding: 16,
    zIndex: 100,
  },
  noResultsText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
