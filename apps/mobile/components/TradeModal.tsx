import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Keyboard,
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

interface SearchResult {
  symbol: string;
  name: string;
  price?: number | null;
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
  const [hasAlpacaLinked, setHasAlpacaLinked] = useState<boolean | null>(null);

  // Search state
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
      setSearchInput(initialSymbol);
      setQuantity(1);
      setError('');
      setQuote(null);
      setCompanyName('');
      setSearchResults([]);
      setShowSearchResults(false);
      setSearchLoading(false);
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
              const price = Number(
                data?.price ??
                  data?.quote?.ap ??
                  data?.quote?.bp ??
                  data?.trade?.p ??
                  data?.bar?.c
              );

              if (Number.isFinite(price) && price > 0) {
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

  // Search for symbols as user types (debounced)
  useEffect(() => {
    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // If no input or input matches selected symbol, don't search
    if (!searchInput || searchInput.length < 1) {
      setSearchResults([]);
      setShowSearchResults(false);
      setSearchLoading(false);
      return;
    }

    // If user has selected a symbol and input matches, don't search
    if (symbol && searchInput.toUpperCase() === symbol.toUpperCase()) {
      setSearchResults([]);
      setSearchLoading(false);
      setShowSearchResults(false);
      return;
    }

    setSearchLoading(true);
    setShowSearchResults(true);

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const { data, error: searchError } = await supabase.functions.invoke('symbols-search', {
          body: { q: searchInput, limit: 8, includePrices: true },
        });

        if (searchError) throw searchError;

        const items = data?.items || [];
        setSearchResults(items);

        // Dismiss keyboard when results appear so user can see the dropdown
        if (items.length > 0) {
          Keyboard.dismiss();
        }
      } catch (err) {
        console.error('Search error:', err);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
    };
  }, [searchInput, symbol]);

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
  const handleSelectResult = useCallback((result: SearchResult) => {
    setSymbol(result.symbol);
    setSearchInput(result.symbol);
    setCompanyName(result.name);
    setShowSearchResults(false);
    setSearchResults([]);

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

        {/* Symbol Search Input */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Search Stock</Text>
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.textInput}
              value={searchInput}
              onChangeText={handleSearchInputChange}
              placeholder="Search by ticker or name..."
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              onFocus={() => {
                if (searchInput && searchInput !== symbol) {
                  setShowSearchResults(true);
                }
              }}
            />
            {(searchLoading || fetchingQuote) && searchInput.length > 0 && (
              <ActivityIndicator
                size="small"
                color={Colors.primary}
                style={styles.inputSpinner}
              />
            )}

            {/* Search Results Dropdown */}
            {showSearchResults && searchResults.length > 0 && (
              <View style={styles.searchResultsContainer}>
                <ScrollView
                  style={styles.searchResultsList}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                >
                  {searchResults.map((item) => (
                    <TouchableOpacity
                      key={item.symbol}
                      style={styles.searchResultItem}
                      onPress={() => handleSelectResult(item)}
                    >
                      <View style={styles.searchResultLeft}>
                        <Text style={styles.searchResultSymbol}>{item.symbol}</Text>
                        <Text style={styles.searchResultName} numberOfLines={1}>
                          {item.name}
                        </Text>
                      </View>
                      {item.price ? (
                        <Text style={styles.searchResultPrice}>
                          ${item.price.toFixed(2)}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* No results message */}
            {showSearchResults && !searchLoading && searchInput.length >= 1 && searchResults.length === 0 && (
              <View style={styles.noResultsContainer}>
                <Text style={styles.noResultsText}>No matching stocks found</Text>
              </View>
            )}
          </View>

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
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
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
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  warningTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#DC2626',
    marginBottom: 8,
  },
  warningText: {
    fontSize: 14,
    color: '#DC2626',
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
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
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
    color: '#FFFFFF',
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
    top: 12,
  },

  // Search container
  searchContainer: {
    position: 'relative',
    zIndex: 10,
  },
  searchResultsContainer: {
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
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  searchResultsList: {
    maxHeight: 250,
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  searchResultLeft: {
    flex: 1,
    marginRight: 12,
  },
  searchResultSymbol: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  searchResultName: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  searchResultPrice: {
    fontSize: 14,
    fontWeight: '600',
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
    color: Colors.textMuted,
    textAlign: 'center',
  },
  selectedStock: {
    marginTop: 10,
    padding: 12,
    backgroundColor: '#ECFDF5',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  selectedSymbol: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.success,
  },
  selectedName: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
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
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
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
    backgroundColor: '#BFDBFE',
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
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 14,
    color: '#DC2626',
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
