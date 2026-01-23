import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useState, useEffect, useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useStockPrices } from '@/lib/useStockPrices';
import { Colors } from '@/constants/Colors';

interface DraftPick {
  symbol: string;
  quantity: number;
  entry_price: number;
}

interface Trade {
  symbol: string;
  action: 'buy' | 'sell';
  quantity: number;
  price: number;
}

interface Holding {
  symbol: string;
  quantity: number;
  avgEntryPrice: number;
  totalCost: number;
  currentPrice: number | null;
  currentValue: number | null;
  gainLoss: number | null;
  gainLossPercent: number | null;
}

interface UserProfile {
  username?: string;
  avatar?: string;
}

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number | null): string {
  if (value === null) return '--';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export default function PlayerPortfolioScreen() {
  const { userId, username } = useLocalSearchParams<{ userId: string; username: string }>();
  const { activeLeagueId, activeLeague } = useLeagueContext();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);

  // Get symbols for price fetching
  const symbols = useMemo(() => holdings.map(h => h.symbol), [holdings]);
  const { prices, loading: pricesLoading } = useStockPrices(symbols);

  // Combine holdings with live prices
  const holdingsWithPrices = useMemo(() => {
    return holdings.map(holding => {
      const priceData = prices[holding.symbol.toUpperCase()];

      if (!priceData) {
        return holding;
      }

      const currentValue = priceData.price * holding.quantity;
      const gainLoss = currentValue - holding.totalCost;
      const gainLossPercent = holding.totalCost > 0 ? (gainLoss / holding.totalCost) * 100 : 0;

      return {
        ...holding,
        currentPrice: priceData.price,
        currentValue,
        gainLoss,
        gainLossPercent,
      };
    });
  }, [holdings, prices]);

  // Calculate portfolio totals
  const portfolioSummary = useMemo(() => {
    const totalCost = holdingsWithPrices.reduce((sum, h) => sum + h.totalCost, 0);
    const totalValue = holdingsWithPrices.reduce((sum, h) => sum + (h.currentValue ?? h.totalCost), 0);
    const totalGainLoss = totalValue - totalCost;
    const totalGainLossPercent = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;
    const hasLivePrices = holdingsWithPrices.some(h => h.currentPrice !== null);

    return {
      totalCost,
      totalValue,
      totalGainLoss,
      totalGainLossPercent,
      hasLivePrices,
      holdingsCount: holdingsWithPrices.length,
    };
  }, [holdingsWithPrices]);

  const isBot = userId?.startsWith('bot-');
  const displayName = username || (isBot ? `Bot ${userId?.replace('bot-', '')}` : 'Player');
  const avatar = isBot ? '🤖' : (profile?.avatar || '📊');

  useEffect(() => {
    if (userId && activeLeagueId) {
      fetchPortfolio();
    }
  }, [userId, activeLeagueId]);

  async function fetchPortfolio() {
    if (!userId || !activeLeagueId) return;

    setLoading(true);

    try {
      // Fetch user profile if not a bot
      if (!isBot) {
        const { data: profileData } = await supabase
          .from('user_profiles')
          .select('username, avatar')
          .eq('id', userId)
          .single();

        if (profileData) {
          setProfile(profileData);
        }
      }

      // Fetch drafts for this user in this league
      const { data: drafts } = await supabase
        .from('drafts')
        .select('symbol, quantity, entry_price')
        .eq('user_id', userId)
        .eq('league_id', activeLeagueId);

      // Fetch trades for this user in this league
      const { data: trades } = await supabase
        .from('trades')
        .select('symbol, action, quantity, price')
        .eq('user_id', userId)
        .eq('league_id', activeLeagueId);

      // Calculate holdings
      const holdingsMap = new Map<string, { quantity: number; totalCost: number }>();

      // Process drafts
      for (const draft of (drafts || [])) {
        const existing = holdingsMap.get(draft.symbol) || { quantity: 0, totalCost: 0 };
        existing.quantity += draft.quantity;
        existing.totalCost += draft.entry_price * draft.quantity;
        holdingsMap.set(draft.symbol, existing);
      }

      // Process trades
      for (const trade of (trades || [])) {
        const existing = holdingsMap.get(trade.symbol) || { quantity: 0, totalCost: 0 };
        if (trade.action === 'buy') {
          existing.quantity += trade.quantity;
          existing.totalCost += trade.price * trade.quantity;
        } else {
          existing.quantity -= trade.quantity;
          if (existing.quantity > 0) {
            const avgCost = existing.totalCost / (existing.quantity + trade.quantity);
            existing.totalCost = avgCost * existing.quantity;
          } else {
            existing.totalCost = 0;
          }
        }
        holdingsMap.set(trade.symbol, existing);
      }

      // Convert to array
      const holdingsArray: Holding[] = [];
      holdingsMap.forEach((value, symbol) => {
        if (value.quantity > 0) {
          holdingsArray.push({
            symbol,
            quantity: value.quantity,
            avgEntryPrice: value.totalCost / value.quantity,
            totalCost: value.totalCost,
            currentPrice: null,
            currentValue: null,
            gainLoss: null,
            gainLossPercent: null,
          });
        }
      });

      setHoldings(holdingsArray);
    } catch (err) {
      console.error('Error fetching portfolio:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{displayName}'s Portfolio</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollView}>
        {/* Player Info Card */}
        <View style={styles.playerCard}>
          <View style={styles.playerAvatar}>
            <Text style={styles.playerAvatarText}>{avatar}</Text>
          </View>
          <View style={styles.playerInfo}>
            <Text style={styles.playerName}>{displayName}</Text>
            <Text style={styles.leagueName}>{activeLeague?.name}</Text>
          </View>
        </View>

        {/* Portfolio Summary */}
        {!loading && holdingsWithPrices.length > 0 && (
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Portfolio Value</Text>
                <Text style={styles.summaryValue}>
                  ${formatCurrency(portfolioSummary.totalValue)}
                </Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Total P/L</Text>
                <Text style={[
                  styles.summaryValue,
                  portfolioSummary.totalGainLoss >= 0 ? styles.positive : styles.negative
                ]}>
                  {portfolioSummary.totalGainLoss >= 0 ? '+' : ''}${formatCurrency(portfolioSummary.totalGainLoss)}
                </Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Return</Text>
                <Text style={[
                  styles.summaryValue,
                  portfolioSummary.totalGainLossPercent >= 0 ? styles.positive : styles.negative
                ]}>
                  {formatPercent(portfolioSummary.totalGainLossPercent)}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Holdings List */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Holdings ({holdingsWithPrices.length})
          </Text>

          {loading ? (
            <View style={styles.loadingContainer}>
              <Text style={styles.loadingText}>Loading portfolio...</Text>
            </View>
          ) : holdingsWithPrices.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>{isBot ? '🤖' : '📭'}</Text>
              <Text style={styles.emptyTitle}>No Holdings</Text>
              <Text style={styles.emptySubtitle}>
                {isBot
                  ? 'This bot has no stocks in their portfolio'
                  : 'This player has no stocks in their portfolio'
                }
              </Text>
            </View>
          ) : (
            holdingsWithPrices.map((holding) => {
              const hasPrice = holding.currentPrice !== null;
              const isPositive = (holding.gainLossPercent ?? 0) >= 0;

              return (
                <View key={holding.symbol} style={styles.holdingRow}>
                  <View style={styles.holdingLeft}>
                    <Text style={styles.holdingSymbol}>{holding.symbol}</Text>
                    <Text style={styles.holdingQty}>{holding.quantity} shares</Text>
                  </View>

                  <View style={styles.holdingMiddle}>
                    <Text style={styles.holdingLabel}>Cost Basis</Text>
                    <Text style={styles.holdingCost}>${holding.avgEntryPrice.toFixed(2)}</Text>
                  </View>

                  <View style={styles.holdingRight}>
                    {hasPrice ? (
                      <>
                        <Text style={[styles.holdingValue, isPositive ? styles.positive : styles.negative]}>
                          {isPositive ? '+' : ''}${formatCurrency(holding.gainLoss!)}
                        </Text>
                        <Text style={[styles.holdingPercent, isPositive ? styles.positive : styles.negative]}>
                          {formatPercent(holding.gainLossPercent)}
                        </Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.holdingValue}>${formatCurrency(holding.totalCost)}</Text>
                        <Text style={styles.holdingPercent}>--</Text>
                      </>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.headerBg,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 44,
  },
  scrollView: {
    flex: 1,
  },
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  playerAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  playerAvatarText: {
    fontSize: 28,
  },
  playerInfo: {
    flex: 1,
  },
  playerName: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  leagueName: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 4,
  },
  summaryCard: {
    backgroundColor: Colors.cardBg,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  summaryRow: {
    flexDirection: 'row',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  section: {
    marginTop: 20,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  holdingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  holdingLeft: {
    flex: 1,
  },
  holdingSymbol: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  holdingQty: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  holdingMiddle: {
    alignItems: 'center',
    marginHorizontal: 12,
  },
  holdingLabel: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  holdingCost: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  holdingRight: {
    alignItems: 'flex-end',
    minWidth: 80,
  },
  holdingValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  holdingPercent: {
    fontSize: 12,
    marginTop: 2,
  },
  positive: {
    color: Colors.success,
  },
  negative: {
    color: Colors.error,
  },
});
