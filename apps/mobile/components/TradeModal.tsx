/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles`/`cardShadow` are declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { Holding } from '@/lib/usePortfolio';
import { isMarketOpen, getMarketStatus, getMarketStatusMessage } from '@/lib/marketHours';
import { parseQuotePrice, type ShapedSearchResult } from '@/lib/symbolSearch';
import * as Haptics from 'expo-haptics';
import { Banner, Button } from '@/components/ui';
import SymbolSearchField from '@/components/SymbolSearchField';

interface TradeModalProps {
  visible: boolean;
  onClose: () => void;
  onTradeComplete: () => void;
  leagueId: string;
  userId: string;
  currentHoldings: Holding[];
  availableCash: number;
  isBudgetMode: boolean;
  leagueType: 'duration' | 'matchup';
  initialSymbol?: string;
  initialAction?: 'buy' | 'sell';
}

interface Quote {
  symbol: string;
  price: number;
}

export default function TradeModal({
  visible,
  onClose,
  onTradeComplete,
  leagueId,
  userId,
  currentHoldings,
  availableCash,
  isBudgetMode,
  leagueType,
  initialSymbol = '',
  initialAction = 'buy',
}: TradeModalProps) {
  // Trading is allowed during market hours (9:30 AM - 4:00 PM ET, Mon-Fri)
  const marketOpen = isMarketOpen();
  const marketStatus = getMarketStatus();
  const marketStatusMessage = getMarketStatusMessage();

  const [action, setAction] = useState<'buy' | 'sell'>(initialAction);
  const [symbol, setSymbol] = useState(initialSymbol);
  const [searchInput, setSearchInput] = useState(initialSymbol);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [fetchingQuote, setFetchingQuote] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setAction(initialAction);
      setSymbol(initialSymbol);
      setSearchInput(initialSymbol);
      setQuantity(1);
      setError('');
      setQuote(null);
      setCompanyName('');
      setFetchingQuote(false);

      // If opening with an initial symbol, fetch its quote
      if (initialSymbol) {
        (async () => {
          setFetchingQuote(true);
          try {
            const upperSym = initialSymbol.trim().toUpperCase();

            // Fetch quote
            const { data, error: quoteError } = await supabase.functions.invoke('quote', {
              body: { symbol: upperSym },
            });

            if (!quoteError && !data?.error) {
              const price = parseQuotePrice(data);
              if (price != null) {
                setQuote({ symbol: upperSym, price });
              }
            }

            // Fetch company name
            const { data: nameData } = await supabase.functions.invoke('symbol-name', {
              body: { symbol: upperSym },
            });
            if (nameData?.name) {
              setCompanyName(nameData.name);
            }
          } catch (err) {
            console.error('Error fetching initial quote:', err);
          } finally {
            setFetchingQuote(false);
          }
        })();
      }
    }
  }, [visible, initialAction, initialSymbol]);

  // Search-by-ticker-or-name typeahead now lives in SymbolSearchField (shared
  // with the draft screen — see lib/useSymbolSearch.ts / lib/symbolSearch.ts).

  // Fetch quote when a symbol is selected
  const fetchQuoteForSymbol = useCallback(async (sym: string) => {
    if (!sym) {
      setQuote(null);
      setCompanyName('');
      return;
    }

    setFetchingQuote(true);
    try {
      const upperSym = sym.trim().toUpperCase();

      // Fetch quote from edge function
      const { data, error: quoteError } = await supabase.functions.invoke('quote', {
        body: { symbol: upperSym },
      });

      if (quoteError) throw quoteError;
      if (data?.error) throw new Error(data.error);

      const price = parseQuotePrice(data);
      if (price == null) {
        setQuote(null);
        setCompanyName('');
        return;
      }

      setQuote({ symbol: upperSym, price });

      // Fetch company name
      const { data: nameData } = await supabase.functions.invoke('symbol-name', {
        body: { symbol: upperSym },
      });
      if (nameData?.name) {
        setCompanyName(nameData.name);
      }
    } catch (err) {
      setQuote(null);
      setCompanyName('');
    } finally {
      setFetchingQuote(false);
    }
  }, []);

  // Handle selecting a search result
  const handleSelectResult = useCallback((result: ShapedSearchResult) => {
    setSymbol(result.symbol);
    setSearchInput(result.symbol);
    setCompanyName(result.name);

    // Use price from search if available, otherwise fetch
    if (result.price && Number.isFinite(result.price) && result.price > 0) {
      setQuote({ symbol: result.symbol, price: result.price });
    } else {
      fetchQuoteForSymbol(result.symbol);
    }
  }, [fetchQuoteForSymbol]);

  // Handle search input changes
  const handleSearchInputChange = useCallback((text: string) => {
    const upper = text.toUpperCase();
    setSearchInput(upper);
    // Clear selected symbol when user starts typing something different
    if (symbol && upper !== symbol) {
      setSymbol('');
      setQuote(null);
      setCompanyName('');
    }
  }, [symbol]);

  // Calculate trade details
  const currentPrice = quote?.price || 0;
  const totalValue = currentPrice * quantity;
  const holding = currentHoldings.find(
    (h) => h.symbol?.toUpperCase() === symbol.toUpperCase()
  );
  const ownedQuantity = holding?.quantity || 0;

  // Validation
  const canAfford = !isBudgetMode || action === 'sell' || totalValue <= availableCash;
  const hasEnoughShares = action === 'buy' || ownedQuantity >= quantity;

  const handleQuantityChange = (delta: number) => {
    setQuantity((prev) => Math.max(1, prev + delta));
  };

  // Refusal reasons from record-trade, mapped to user-facing copy.
  const TRADE_REFUSAL_MESSAGES: Record<string, string> = {
    draft_not_completed: 'Trading opens after the draft completes.',
    symbol_owned: 'That stock is already owned in this league.',
    not_draftable: "That stock isn't in this league's draftable universe.",
    roster_full: 'Your roster is full — drop a stock first.',
    no_eligible_slot: 'No open roster slot accepts a stock at this price.',
    over_budget: 'That stock is over your remaining budget.',
    not_owned: "You don't own that stock.",
    no_price: 'No recent price available for that stock.',
    rate_limited: 'Too many trades too quickly — wait a moment and try again.',
  };

  const handleSubmit = async () => {
    // Phase 3 (DR-001): trades go through the record-trade edge function —
    // the in-house simulator fill path (app-key quote, server-side legality).
    // The server computes quantity per stake mode and a sell always drops the
    // ENTIRE position (freeing the symbol league-wide); the local quantity
    // stepper is a display-only estimate until the Phase 4 UI pass.
    if (!symbol) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('record-trade', {
        body: { league_id: leagueId, symbol: symbol.trim().toUpperCase(), action },
      });
      if (fnError) throw fnError;
      if (!data?.ok) {
        setError(TRADE_REFUSAL_MESSAGES[data?.reason] || 'Trade was refused.');
        return;
      }
      // Success - refresh data and close
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onTradeComplete();
      onClose();
    } catch (_e) {
      setError('Failed to submit trade. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderContent = () => {
    // Market is closed
    if (!marketOpen) {
      return (
        <View style={styles.lockedBox}>
          <Text style={styles.lockedTitle}>Market Closed</Text>
          <Text style={styles.lockedText}>
            {marketStatusMessage}
          </Text>
          <Text style={styles.lockedSubtext}>
            Trading is available during market hours:{'\n'}
            <Text style={styles.bold}>9:30 AM - 4:00 PM ET, Monday - Friday</Text>
          </Text>
          <TouchableOpacity style={styles.lockedButton} onPress={onClose}>
            <Text style={styles.lockedButtonText}>Got it</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Trading form
    return (
      <ScrollView style={styles.formScroll} keyboardShouldPersistTaps="handled">
        {/* Buy/Sell Toggle */}
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggleButton, action === 'buy' && styles.toggleButtonBuy]}
            onPress={() => setAction('buy')}
          >
            <Text
              style={[
                styles.toggleButtonText,
                action === 'buy' && styles.toggleButtonTextActive,
              ]}
            >
              Buy
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleButton, action === 'sell' && styles.toggleButtonSell]}
            onPress={() => setAction('sell')}
          >
            <Text
              style={[
                styles.toggleButtonText,
                action === 'sell' && styles.toggleButtonTextActive,
              ]}
            >
              Sell
            </Text>
          </TouchableOpacity>
        </View>

        {/* Symbol Search Input */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Search Stock</Text>
          <SymbolSearchField
            value={searchInput}
            onChangeText={handleSearchInputChange}
            onSelect={handleSelectResult}
            selectedSymbol={symbol}
            extraLoading={fetchingQuote}
          />

          {/* Selected stock info */}
          {symbol && companyName ? (
            <View style={styles.selectedStock}>
              <Text style={styles.selectedSymbol}>{symbol}</Text>
              <Text style={styles.selectedName}>{companyName}</Text>
            </View>
          ) : null}
        </View>

        {/* Quantity Input */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Quantity</Text>
          <View style={styles.quantityRow}>
            <TouchableOpacity
              style={styles.quantityButton}
              onPress={() => handleQuantityChange(-1)}
              disabled={quantity <= 1}
              accessibilityRole="button"
              accessibilityLabel="Decrease quantity"
              accessibilityState={{ disabled: quantity <= 1 }}
            >
              <Text style={styles.quantityButtonText}>−</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.quantityInput}
              value={String(quantity)}
              onChangeText={(text) => {
                const num = parseInt(text) || 1;
                setQuantity(Math.max(1, num));
              }}
              keyboardType="number-pad"
              selectTextOnFocus
            />
            <TouchableOpacity
              style={styles.quantityButton}
              onPress={() => handleQuantityChange(1)}
              accessibilityRole="button"
              accessibilityLabel="Increase quantity"
            >
              <Text style={styles.quantityButtonText}>+</Text>
            </TouchableOpacity>
          </View>
          {action === 'sell' && ownedQuantity > 0 && (
            <Text style={styles.ownedText}>You own {ownedQuantity} shares</Text>
          )}
        </View>

        {/* Price Info */}
        {quote && (
          <View style={styles.priceBox}>
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Current Price</Text>
              <Text style={styles.priceValue}>${currentPrice.toFixed(2)}</Text>
            </View>
            <View style={styles.priceDivider} />
            <View style={styles.priceRow}>
              <Text style={styles.totalLabel}>
                Total {action === 'buy' ? 'Cost' : 'Proceeds'}
              </Text>
              <Text
                style={[
                  styles.totalValue,
                  action === 'buy' ? styles.totalCost : styles.totalProceeds,
                ]}
              >
                ${totalValue.toFixed(2)}
              </Text>
            </View>
          </View>
        )}

        {/* Budget Info */}
        {isBudgetMode && action === 'buy' && (
          <Text style={styles.budgetText}>
            Available Cash: <Text style={styles.bold}>${availableCash.toFixed(2)}</Text>
          </Text>
        )}

        {/* Sells drop the entire position (frees the symbol league-wide) */}
        {action === 'sell' && ownedQuantity > 0 && (
          <Text style={styles.budgetText}>
            Selling drops your entire position ({ownedQuantity}{' '}
            {ownedQuantity === 1 ? 'share' : 'shares'}).
          </Text>
        )}

        {/* Error Message */}
        {error ? (
          <Banner variant="error" message={error} style={styles.errorBanner} />
        ) : null}

        {/* Action Buttons */}
        <View style={styles.buttonRow}>
          <Button
            title={action === 'buy' ? 'Buy' : 'Sell'}
            onPress={handleSubmit}
            disabled={!symbol || !canAfford || !hasEnoughShares}
            loading={loading}
            variant={action === 'buy' ? 'success' : 'danger'}
            style={styles.submitButton}
          />
          <Button
            title="Cancel"
            onPress={onClose}
            disabled={loading}
            variant="secondary"
          />
        </View>
      </ScrollView>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <TouchableOpacity
          style={styles.overlayBackground}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.modalContainer}>
          <View style={styles.handle} />
          <Text style={styles.title}>Trade Stock</Text>
          {renderContent()}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlayBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
  },
  modalContainer: {
    backgroundColor: Colors.cardBg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    marginBottom: 20,
  },
  formScroll: {
    flexGrow: 0,
  },
  // Locked box (not Monday)
  lockedBox: {
    backgroundColor: Colors.warningBg,
    borderWidth: 1,
    borderColor: Colors.warningBorder,
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  lockedTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.gold,
    marginBottom: 8,
  },
  lockedText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginBottom: 8,
    lineHeight: 20,
  },
  lockedSubtext: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    marginBottom: 16,
  },
  lockedButton: {
    backgroundColor: Colors.gold,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  lockedButtonText: {
    color: Colors.white,
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  bold: {
    fontFamily: 'Inter_700Bold',
  },

  // Toggle
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: Colors.inputBg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  toggleButtonBuy: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
  },
  toggleButtonSell: {
    backgroundColor: Colors.error,
    borderColor: Colors.error,
  },
  toggleButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textMuted,
  },
  toggleButtonTextActive: {
    color: Colors.white,
  },

  // Input groups
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    marginBottom: 8,
  },
  // Search input/dropdown now lives in components/SymbolSearchField.tsx
  // (shared with the draft screen).
  selectedStock: {
    marginTop: 10,
    padding: 12,
    backgroundColor: Colors.successBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.successBorder,
  },
  selectedSymbol: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: Colors.success,
  },
  selectedName: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    marginTop: 2,
  },
  companyName: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    marginTop: 6,
  },

  // Quantity
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  quantityButton: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: Colors.inputBg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityButtonText: {
    fontSize: 24,
    color: Colors.textPrimary,
    fontFamily: 'Inter_500Medium',
    fontVariant: ['tabular-nums'],
  },
  quantityInput: {
    flex: 1,
    backgroundColor: Colors.inputBg,
    borderRadius: 8,
    padding: 14,
    fontSize: 18,
    fontFamily: 'Inter_400Regular',
    fontVariant: ['tabular-nums'],
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
    textAlign: 'center',
  },
  ownedText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    marginTop: 8,
  },

  // Price box
  priceBox: {
    backgroundColor: Colors.infoBg,
    borderWidth: 1,
    borderColor: Colors.infoBorder,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  priceLabel: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    fontVariant: ['tabular-nums'],
    color: Colors.textMuted,
  },
  priceValue: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    fontVariant: ['tabular-nums'],
    color: Colors.textPrimary,
  },
  priceDivider: {
    height: 1,
    backgroundColor: Colors.infoBorder,
    marginVertical: 12,
  },
  totalLabel: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
    color: Colors.textPrimary,
  },
  totalValue: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
  },
  totalCost: {
    color: Colors.error,
  },
  totalProceeds: {
    color: Colors.success,
  },

  // Budget
  budgetText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    fontVariant: ['tabular-nums'],
    color: Colors.textMuted,
    marginBottom: 16,
  },

  // Error
  errorBanner: {
    marginBottom: 16,
  },

  // Buttons
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  submitButton: {
    flex: 1,
  },
});