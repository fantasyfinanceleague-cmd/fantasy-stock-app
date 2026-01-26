import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { Holding } from '@/lib/usePortfolio';
import { isMarketOpen, getMarketStatus, getMarketStatusMessage } from '@/lib/marketHours';

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
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [fetchingQuote, setFetchingQuote] = useState(false);
  const [hasAlpacaLinked, setHasAlpacaLinked] = useState<boolean | null>(null);

  // Check if user has Alpaca account linked
  useEffect(() => {
    if (!visible || !userId) return;

    async function checkAlpacaLink() {
      const { data, error } = await supabase
        .from('broker_credentials')
        .select('key_id')
        .eq('user_id', userId)
        .eq('broker', 'alpaca')
        .single();

      setHasAlpacaLinked(!error && !!data);
    }

    checkAlpacaLink();
  }, [visible, userId]);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setAction(initialAction);
      setSymbol(initialSymbol);
      setQuantity(1);
      setError('');
      setQuote(null);
      setCompanyName('');
    }
  }, [visible, initialAction, initialSymbol]);

  // Fetch quote when symbol changes (debounced)
  useEffect(() => {
    if (!symbol || symbol.length < 1) {
      setQuote(null);
      setCompanyName('');
      return;
    }

    const timer = setTimeout(async () => {
      setFetchingQuote(true);
      try {
        const sym = symbol.trim().toUpperCase();

        // Fetch quote from edge function
        const { data, error: quoteError } = await supabase.functions.invoke('quote', {
          body: { symbol: sym },
        });

        if (quoteError) throw quoteError;
        if (data?.error) throw new Error(data.error);

        const price = Number(
          data?.price ??
            data?.quote?.ap ??
            data?.quote?.bp ??
            data?.trade?.p ??
            data?.bar?.c
        );

        if (!Number.isFinite(price) || price <= 0) {
          setQuote(null);
          setCompanyName('');
          return;
        }

        setQuote({ symbol: sym, price });

        // Fetch company name
        const { data: nameData } = await supabase.functions.invoke('symbol-name', {
          body: { symbol: sym },
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
    }, 500);

    return () => clearTimeout(timer);
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

  const handleSubmit = async () => {
    setError('');

    if (!quote) {
      setError('Please enter a valid stock symbol');
      return;
    }

    if (!canAfford) {
      setError(`Insufficient funds. You have $${availableCash.toFixed(2)} available.`);
      return;
    }

    if (!hasEnoughShares) {
      setError(`You only own ${ownedQuantity} shares of ${symbol.toUpperCase()}`);
      return;
    }

    setLoading(true);

    try {
      const upperSymbol = symbol.toUpperCase();

      // 1) Place paper order via Alpaca Edge Function
      const { data: placeData, error: placeErr } = await supabase.functions.invoke(
        'place-order',
        {
          body: {
            symbol: upperSymbol,
            qty: quantity,
            side: action,
            type: 'market',
            time_in_force: 'day',
          },
        }
      );

      // Handle Alpaca errors
      if (placeErr || placeData?.error) {
        console.error('place-order failed:', placeErr || placeData);

        if (placeData?.error === 'credentials_invalid') {
          setError(
            placeData.message ||
              'Your Alpaca credentials are invalid or expired. Please update them in Profile.'
          );
          setLoading(false);
          return;
        }

        if (placeData?.error === 'insufficient_funds') {
          setError(
            placeData.message || 'Insufficient buying power in your Alpaca account.'
          );
          setLoading(false);
          return;
        }

        if (placeData?.error === 'no_credentials') {
          setError(
            placeData.message || 'Please link your Alpaca account in Profile settings.'
          );
          setLoading(false);
          return;
        }

        // For other Alpaca errors, stop - don't record a trade that didn't happen
        setError(placeData?.message || 'Trade failed. Please try again.');
        setLoading(false);
        return;
      }

      // Use the actual fill price from Alpaca (not our quote)
      const fillPrice = placeData?.filled_avg_price ?? currentPrice;
      const fillQty = placeData?.filled_qty ?? quantity;
      const actualTotalValue = fillPrice * fillQty;

      // 2) Insert trade into database with Alpaca's actual fill price
      const { error: tradeError } = await supabase.from('trades').insert({
        league_id: leagueId,
        user_id: userId,
        symbol: upperSymbol,
        action: action,
        quantity: fillQty,
        price: fillPrice,
        total_value: actualTotalValue,
        alpaca_order_id: placeData?.order?.id ?? null,
      });

      if (tradeError) throw tradeError;

      // Success - refresh data and close
      onTradeComplete();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to execute trade');
    } finally {
      setLoading(false);
    }
  };

  const renderContent = () => {
    // Loading Alpaca status
    if (hasAlpacaLinked === null) {
      return (
        <View style={styles.centeredContent}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Checking account status...</Text>
        </View>
      );
    }

    // No Alpaca linked
    if (hasAlpacaLinked === false) {
      return (
        <View style={styles.warningBox}>
          <Text style={styles.warningTitle}>Alpaca Account Required</Text>
          <Text style={styles.warningText}>
            You need to link your Alpaca paper trading account before you can trade.
          </Text>
          <Text style={styles.warningSubtext}>
            Go to your Profile settings to link your Alpaca API keys.
          </Text>
          <TouchableOpacity style={styles.warningButton} onPress={onClose}>
            <Text style={styles.warningButtonText}>Got it</Text>
          </TouchableOpacity>
        </View>
      );
    }

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

        {/* Symbol Input */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Stock Symbol</Text>
          <TextInput
            style={styles.textInput}
            value={symbol}
            onChangeText={(text) => setSymbol(text.toUpperCase())}
            placeholder="AAPL"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          {fetchingQuote && (
            <ActivityIndicator
              size="small"
              color={Colors.primary}
              style={styles.inputSpinner}
            />
          )}
          {companyName ? (
            <Text style={styles.companyName}>{companyName}</Text>
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

        {/* Error Message */}
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Action Buttons */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              action === 'buy' ? styles.submitButtonBuy : styles.submitButtonSell,
              (loading || !quote || !canAfford || !hasEnoughShares) &&
                styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={loading || !quote || !canAfford || !hasEnoughShares}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>
                {action === 'buy' ? 'Buy' : 'Sell'} {quantity} Share
                {quantity !== 1 ? 's' : ''}
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={onClose}
            disabled={loading}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
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
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
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
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 20,
  },
  formScroll: {
    flexGrow: 0,
  },
  centeredContent: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    color: Colors.textMuted,
    marginTop: 12,
    fontSize: 14,
  },

  // Warning box (no Alpaca)
  warningBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  warningTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#f87171',
    marginBottom: 8,
  },
  warningText: {
    fontSize: 14,
    color: '#f87171',
    marginBottom: 8,
    lineHeight: 20,
  },
  warningSubtext: {
    fontSize: 13,
    color: Colors.textMuted,
    marginBottom: 16,
  },
  warningButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  warningButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  // Locked box (not Monday)
  lockedBox: {
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.3)',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  lockedTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.gold,
    marginBottom: 8,
  },
  lockedText: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 8,
    lineHeight: 20,
  },
  lockedSubtext: {
    fontSize: 13,
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
    color: Colors.background,
    fontSize: 16,
    fontWeight: '600',
  },
  bold: {
    fontWeight: '700',
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
    fontWeight: '600',
    color: Colors.textMuted,
  },
  toggleButtonTextActive: {
    color: '#fff',
  },

  // Input groups
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 13,
    color: Colors.textMuted,
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: Colors.inputBg,
    borderRadius: 8,
    padding: 14,
    fontSize: 18,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inputSpinner: {
    position: 'absolute',
    right: 14,
    top: 40,
  },
  companyName: {
    fontSize: 12,
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
    fontWeight: '500',
  },
  quantityInput: {
    flex: 1,
    backgroundColor: Colors.inputBg,
    borderRadius: 8,
    padding: 14,
    fontSize: 18,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
    textAlign: 'center',
  },
  ownedText: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 8,
  },

  // Price box
  priceBox: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
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
    color: Colors.textMuted,
  },
  priceValue: {
    fontSize: 16,
    color: Colors.textPrimary,
  },
  priceDivider: {
    height: 1,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    marginVertical: 12,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '700',
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
    color: Colors.textMuted,
    marginBottom: 16,
  },

  // Error
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 14,
    color: '#f87171',
  },

  // Buttons
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  submitButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitButtonBuy: {
    backgroundColor: Colors.success,
  },
  submitButtonSell: {
    backgroundColor: Colors.error,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: Colors.inputBg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontWeight: '500',
  },
});
